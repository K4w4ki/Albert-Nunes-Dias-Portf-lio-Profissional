(() => {
  'use strict';

  const list = document.querySelector('#fileList');
  if (!list || !document.querySelector('#workspace')) return;

  const selected = new Set();
  let sortKey = 'name';
  let sortDirection = 1;
  let busy = false;
  let observerScheduled = false;

  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Sua sessão expirou. Entre novamente.');
    if (!response.ok) throw new Error(data.error || 'A operação falhou.');
    return data;
  };

  const notify = (message, error = false) => {
    const el = document.querySelector('#workspaceMessage');
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle('is-error', error);
  };

  const getId = (row) => {
    const link = row.querySelector('a.file-action[href*="/api/drive/download?id="]');
    if (!link) return '';
    try { return new URL(link.href, location.origin).searchParams.get('id') || ''; }
    catch { return ''; }
  };
  const getName = (row) => row.querySelector('.file-name')?.textContent?.trim() || '';
  const getSize = (row) => {
    const text = row.querySelector('.file-size')?.textContent || '';
    const match = text.match(/([\d.,]+)\s*(bytes|KB|MB|GB|TB)/i);
    if (!match) return 0;
    const number = Number(match[1].replace(/\./g, '').replace(',', '.'));
    const units = { bytes: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
    return number * (units[match[2]] || 1);
  };
  const getDate = (row) => {
    const el = row.querySelector('time');
    const date = el?.dateTime ? Date.parse(el.dateTime) : Date.parse(el?.textContent || '');
    return Number.isFinite(date) ? date : 0;
  };

  function makeToolbar() {
    if (document.querySelector('#vaultManagerToolbar')) return;
    const toolbar = document.createElement('section');
    toolbar.id = 'vaultManagerToolbar';
    toolbar.className = 'vault-manager-toolbar';
    toolbar.innerHTML = `
      <div class="vault-manager-toolbar__top">
        <label class="vault-manager-selectall"><input id="vaultSelectAll" type="checkbox"><span>Selecionar todos</span></label>
        <div class="vault-manager-sort">
          <label for="vaultSort">Ordenar por</label>
          <select id="vaultSort">
            <option value="name">Nome</option>
            <option value="size">Tamanho</option>
            <option value="date">Data de modificação</option>
          </select>
          <button id="vaultSortDirection" type="button" class="vault-manager-small-button" aria-label="Inverter ordem" title="Inverter ordem">↑</button>
        </div>
      </div>
      <div class="vault-manager-toolbar__bottom">
        <span id="vaultSelectionCount">0 selecionados</span>
        <div class="vault-manager-actions">
          <button id="vaultBulkRename" type="button" disabled>Renomear</button>
          <button id="vaultBulkCopy" type="button" disabled>Copiar</button>
          <button id="vaultBulkDelete" type="button" class="is-danger" disabled>Excluir</button>
        </div>
      </div>`;
    const head = document.querySelector('.file-list-head');
    (head || list).insertAdjacentElement('beforebegin', toolbar);

    toolbar.querySelector('#vaultSelectAll').addEventListener('change', (event) => {
      const checked = event.target.checked;
      list.querySelectorAll('.file-row[data-vault-id]').forEach((row) => {
        const id = row.dataset.vaultId;
        if (checked) selected.add(id);
        else selected.delete(id);
        const checkbox = row.querySelector('.vault-manager-checkbox');
        if (checkbox) checkbox.checked = checked;
      });
      updateSelection();
    });
    toolbar.querySelector('#vaultSort').addEventListener('change', (event) => {
      sortKey = event.target.value;
      sortRows();
    });
    toolbar.querySelector('#vaultSortDirection').addEventListener('click', () => {
      sortDirection *= -1;
      toolbar.querySelector('#vaultSortDirection').textContent = sortDirection === 1 ? '↑' : '↓';
      sortRows();
    });
    toolbar.querySelector('#vaultBulkRename').addEventListener('click', () => bulkAction('rename'));
    toolbar.querySelector('#vaultBulkCopy').addEventListener('click', () => bulkAction('copy'));
    toolbar.querySelector('#vaultBulkDelete').addEventListener('click', () => bulkAction('delete'));
  }

  function updateSelection() {
    const toolbar = document.querySelector('#vaultManagerToolbar');
    if (!toolbar) return;
    const rows = [...list.querySelectorAll('.file-row[data-vault-id]')];
    const visibleIds = rows.map((row) => row.dataset.vaultId);
    const visibleSelected = visibleIds.filter((id) => selected.has(id)).length;
    toolbar.querySelector('#vaultSelectionCount').textContent =
      `${selected.size} selecionado${selected.size === 1 ? '' : 's'}`;
    const all = toolbar.querySelector('#vaultSelectAll');
    all.checked = rows.length > 0 && visibleSelected === rows.length;
    all.indeterminate = visibleSelected > 0 && visibleSelected < rows.length;
    toolbar.querySelector('#vaultBulkRename').disabled = busy || selected.size !== 1;
    toolbar.querySelector('#vaultBulkCopy').disabled = busy || selected.size === 0;
    toolbar.querySelector('#vaultBulkDelete').disabled = busy || selected.size === 0;
  }

  function sortRows() {
    // Reordering the rows may trigger the observer, but the observer never calls sortRows.
    const rows = [...list.querySelectorAll('.file-row[data-vault-id]')];
    rows.sort((a, b) => {
      let comparison = 0;
      if (sortKey === 'size') comparison = getSize(a) - getSize(b);
      else if (sortKey === 'date') comparison = getDate(a) - getDate(b);
      else comparison = getName(a).localeCompare(getName(b), 'pt-BR', { sensitivity: 'base' });
      return comparison * sortDirection;
    });
    const fragment = document.createDocumentFragment();
    rows.forEach((row) => fragment.append(row));
    list.append(fragment);
  }

  async function runAction(action, id, name) {
    return request('/api/drive/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id, ...(name ? { name } : {}) })
    });
  }

  async function bulkAction(action) {
    const ids = [...selected];
    if (!ids.length || busy) return;
    let newName = '';
    if (action === 'rename') {
      if (ids.length !== 1) return notify('Selecione apenas um arquivo para renomear.', true);
      const row = [...list.querySelectorAll('.file-row[data-vault-id]')].find((item) => item.dataset.vaultId === ids[0]);
      newName = window.prompt('Digite o novo nome do arquivo:', getName(row));
      if (newName === null) return;
      newName = newName.trim();
      if (!newName) return notify('O nome não pode ficar vazio.', true);
    }
    if (action === 'delete') {
      const message = ids.length === 1
        ? 'Tem certeza de que deseja excluir este arquivo do Google Drive?'
        : `Tem certeza de que deseja excluir ${ids.length} arquivos do Google Drive?`;
      if (!window.confirm(`${message}\n\nOs arquivos serão enviados para a lixeira do Google Drive.`)) return;
    }

    busy = true;
    updateSelection();
    let succeeded = 0;
    const errors = [];
    try {
      for (const id of ids) {
        try { await runAction(action, id, newName || undefined); succeeded += 1; }
        catch (error) { errors.push(error.message || 'Falha na operação'); }
      }
      selected.clear();
      if (errors.length) notify(`${succeeded} concluída(s); ${errors.length} falharam: ${errors[0]}`, true);
      else if (action === 'delete') notify(`${succeeded} arquivo(s) enviado(s) para a lixeira.`);
      else if (action === 'copy') notify(`${succeeded} cópia(s) criada(s).`);
      else notify('Arquivo renomeado com sucesso.');
      const refresh = document.querySelector('#refreshButton');
      if (refresh) refresh.click();
    } finally {
      busy = false;
      updateSelection();
    }
  }

  function enhanceRows() {
    list.querySelectorAll('.file-row').forEach((row) => {
      const id = getId(row);
      if (!id) return;
      row.dataset.vaultId = id;
      if (!row.querySelector('.vault-manager-checkbox')) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'vault-manager-checkbox';
        checkbox.setAttribute('aria-label', `Selecionar ${getName(row)}`);
        checkbox.checked = selected.has(id);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(id);
          else selected.delete(id);
          updateSelection();
        });
        const info = row.querySelector('.file-info');
        if (info) info.prepend(checkbox);
      }
    });
    updateSelection();
  }

  function scheduleEnhance() {
    if (observerScheduled) return;
    observerScheduled = true;
    queueMicrotask(() => {
      observerScheduled = false;
      enhanceRows();
    });
  }

  makeToolbar();
  enhanceRows();

  // Observe only direct list changes. The callback only adds checkboxes and never sorts,
  // so sorting cannot cause an observer/sort feedback loop.
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(list, { childList: true, subtree: false });

  const toolbar = document.querySelector('#vaultManagerToolbar');
  if (toolbar) {
    const syncVisibility = () => {
      const hasRows = Boolean(list.querySelector('.file-row'));
      toolbar.hidden = !hasRows;
    };
    const visibilityObserver = new MutationObserver(syncVisibility);
    visibilityObserver.observe(list, { childList: true });
    syncVisibility();
  }
})();
