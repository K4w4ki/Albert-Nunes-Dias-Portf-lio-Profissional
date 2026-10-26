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

  // Lê o id de uma linha (arquivo ou pasta). privado.js já grava data-vault-id
  // em toda linha; o fallback por link de download existe só por segurança.
  const getId = (row) => {
    if (row.dataset.vaultId) return row.dataset.vaultId;
    const link = row.querySelector('a.file-action[href*="/api/drive/download?id="]');
    if (!link) return '';
    try { return new URL(link.href, location.origin).searchParams.get('id') || ''; }
    catch { return ''; }
  };
  const isFolderRow = (row) => row.classList.contains('is-folder');
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
          <button id="vaultBulkMove" type="button" disabled>Mover</button>
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
    toolbar.querySelector('#vaultBulkMove').addEventListener('click', () => openMoveDialog([...selected]));
  }

  function updateSelection() {
    const toolbar = document.querySelector('#vaultManagerToolbar');
    if (!toolbar) return;
    const rows = [...list.querySelectorAll('.file-row[data-vault-id]')];
    const visibleIds = rows.map((row) => row.dataset.vaultId);
    const visibleSelected = visibleIds.filter((id) => selected.has(id)).length;
    const selectedRows = rows.filter((row) => selected.has(row.dataset.vaultId));
    const hasFolder = selectedRows.some(isFolderRow);
    toolbar.querySelector('#vaultSelectionCount').textContent =
      `${selected.size} selecionado${selected.size === 1 ? '' : 's'}`;
    const all = toolbar.querySelector('#vaultSelectAll');
    all.checked = rows.length > 0 && visibleSelected === rows.length;
    all.indeterminate = visibleSelected > 0 && visibleSelected < rows.length;
    toolbar.querySelector('#vaultBulkRename').disabled = busy || selected.size !== 1;
    toolbar.querySelector('#vaultBulkMove').disabled = busy || selected.size === 0;
    toolbar.querySelector('#vaultBulkCopy').disabled = busy || selected.size === 0 || hasFolder;
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

  async function runAction(action, id, name, destinationId) {
    return request('/api/drive/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id, ...(name ? { name } : {}), ...(destinationId !== undefined ? { destinationId } : {}) })
    });
  }

  async function bulkAction(action) {
    const ids = [...selected];
    if (!ids.length || busy) return;
    let newName = '';
    if (action === 'rename') {
      if (ids.length !== 1) return notify('Selecione apenas um item para renomear.', true);
      const row = [...list.querySelectorAll('.file-row[data-vault-id]')].find((item) => item.dataset.vaultId === ids[0]);
      newName = window.prompt('Digite o novo nome:', getName(row));
      if (newName === null) return;
      newName = newName.trim();
      if (!newName) return notify('O nome não pode ficar vazio.', true);
    }
    if (action === 'delete') {
      const message = ids.length === 1
        ? 'Tem certeza de que deseja excluir este item do Google Drive?'
        : `Tem certeza de que deseja excluir ${ids.length} itens do Google Drive?`;
      if (!window.confirm(`${message}\n\nPastas são excluídas com todo o conteúdo. Os itens serão enviados para a lixeira do Google Drive.`)) return;
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
      else if (action === 'delete') notify(`${succeeded} item(ns) enviado(s) para a lixeira.`);
      else if (action === 'copy') notify(`${succeeded} cópia(s) criada(s).`);
      else notify('Item renomeado com sucesso.');
      window.vaultWorkspace?.refresh();
    } finally {
      busy = false;
      updateSelection();
    }
  }

  // --- Diálogo "Mover para…": navega por pastas e move os itens selecionados
  // para a pasta que estiver aberta no diálogo no momento da confirmação. ---

  // Fecha um <dialog> esperando a animação de saída terminar (classe .is-closing,
  // ver privado.css), em vez de sumir abruptamente com dialog.close().
  function closeModal(dialogEl) {
    if (!dialogEl || !dialogEl.open || dialogEl.classList.contains('is-closing')) return;
    dialogEl.classList.add('is-closing');
    const inner = dialogEl.querySelector('.vault-modal-inner');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      dialogEl.classList.remove('is-closing');
      dialogEl.close();
    };
    inner?.addEventListener('animationend', finish, { once: true });
    window.setTimeout(finish, 200);
  }

  const moveDialog = document.querySelector('#moveDialog');
  const moveBreadcrumbEl = document.querySelector('#moveBreadcrumb');
  const moveListEl = document.querySelector('#moveFolderList');
  const moveConfirmButton = document.querySelector('#moveConfirm');
  let moveIds = [];
  let moveTrail = [];

  async function openMoveDialog(ids) {
    if (!ids.length || !moveDialog) return;
    moveIds = ids;
    moveTrail = [{ id: '', name: 'Meus arquivos' }];
    await renderMoveLevel();
    moveDialog.showModal();
  }

  async function renderMoveLevel() {
    const current = moveTrail[moveTrail.length - 1];
    moveBreadcrumbEl.replaceChildren();
    moveTrail.forEach((crumb, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'vault-breadcrumb-sep';
        sep.textContent = '/';
        moveBreadcrumbEl.append(sep);
      }
      const isLast = index === moveTrail.length - 1;
      if (isLast) {
        const span = document.createElement('span');
        span.className = 'vault-breadcrumb-current';
        span.textContent = crumb.name;
        moveBreadcrumbEl.append(span);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vault-breadcrumb-link';
        btn.textContent = crumb.name;
        btn.addEventListener('click', () => { moveTrail = moveTrail.slice(0, index + 1); renderMoveLevel(); });
        moveBreadcrumbEl.append(btn);
      }
    });

    moveListEl.innerHTML = '<div class="loading-state"><span class="spinner"></span> Carregando pastas…</div>';
    try {
      const params = new URLSearchParams({ onlyFolders: '1' });
      if (current.id) params.set('folderId', current.id);
      const data = await request(`/api/drive/list?${params.toString()}`);
      const folders = (Array.isArray(data.files) ? data.files : []).filter((folder) => !moveIds.includes(folder.id));
      moveListEl.replaceChildren();
      if (!folders.length) {
        const empty = document.createElement('p');
        empty.className = 'move-empty';
        empty.textContent = 'Nenhuma subpasta aqui.';
        moveListEl.append(empty);
      }
      folders.forEach((folder) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'move-folder-row';
        row.textContent = folder.name;
        row.addEventListener('click', () => { moveTrail = [...moveTrail, { id: folder.id, name: folder.name }]; renderMoveLevel(); });
        moveListEl.append(row);
      });
    } catch (error) {
      moveListEl.replaceChildren();
      const empty = document.createElement('p');
      empty.className = 'move-empty';
      empty.textContent = error.message || 'Não foi possível carregar as pastas.';
      moveListEl.append(empty);
    }
  }

  moveConfirmButton?.addEventListener('click', async () => {
    const destination = moveTrail[moveTrail.length - 1];
    moveConfirmButton.disabled = true;
    moveConfirmButton.textContent = 'Movendo…';
    let succeeded = 0;
    const errors = [];
    try {
      for (const id of moveIds) {
        try { await runAction('move', id, undefined, destination.id); succeeded += 1; }
        catch (error) { errors.push(error.message || 'Falha ao mover'); }
      }
      closeModal(moveDialog);
      selected.clear();
      updateSelection();
      if (errors.length) notify(`${succeeded} movido(s); ${errors.length} falharam: ${errors[0]}`, true);
      else notify(`${succeeded} item(ns) movido(s) para "${destination.name}".`);
      window.vaultWorkspace?.refresh();
    } finally {
      moveConfirmButton.disabled = false;
      moveConfirmButton.textContent = 'Mover para cá';
    }
  });
  document.querySelector('#moveDialogClose')?.addEventListener('click', () => closeModal(moveDialog));
  moveDialog?.addEventListener('click', (event) => { if (event.target === moveDialog) closeModal(moveDialog); });

  // --- Menu de contexto (clique com o botão direito), igual ao do Explorer ---

  const contextMenuEl = document.querySelector('#vaultContextMenu');

  const ICONS = {
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    newFolder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v4M10 13h4"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M12 16V3m-5 5 5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 11.8-2L20 12M4 12l2.7 5a7 7 0 0 0 11.8-2"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v3h16v-3"/></svg>',
    rename: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    move: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 14l3-3-3-3"/><path d="M8 11h5"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    delete: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>'
  };

  let contextMenuCloseTimer = null;

  function closeContextMenu() {
    if (!contextMenuEl || contextMenuEl.hidden) return;
    window.clearTimeout(contextMenuCloseTimer);
    contextMenuEl.classList.add('is-closing');
    contextMenuCloseTimer = window.setTimeout(() => {
      contextMenuEl.hidden = true;
      contextMenuEl.classList.remove('is-closing');
      contextMenuEl.replaceChildren();
    }, 100);
  }

  function openContextMenu(x, y, items) {
    if (!contextMenuEl) return;
    window.clearTimeout(contextMenuCloseTimer);
    contextMenuEl.classList.remove('is-closing');
    contextMenuEl.replaceChildren();
    items.forEach((item) => {
      if (item === 'separator') {
        contextMenuEl.append(document.createElement('hr'));
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      if (item.icon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'vault-context-menu-icon';
        iconSpan.innerHTML = item.icon;
        button.append(iconSpan);
      }
      const label = document.createElement('span');
      label.className = 'vault-context-menu-label';
      label.textContent = item.label;
      button.append(label);
      if (item.danger) button.classList.add('is-danger');
      if (item.disabled) button.disabled = true;
      button.addEventListener('click', () => {
        closeContextMenu();
        item.onSelect?.();
      });
      contextMenuEl.append(button);
    });
    contextMenuEl.style.left = '0px';
    contextMenuEl.style.top = '0px';
    contextMenuEl.hidden = false;
    // Reinicia a animação de entrada mesmo se o menu já estava visível em
    // outro lugar (clique direito seguido de outro, sem fechar antes).
    contextMenuEl.style.animation = 'none';
    void contextMenuEl.offsetWidth;
    contextMenuEl.style.animation = '';
    const rect = contextMenuEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    // A animação "cresce" a partir do canto mais próximo do clique, em vez de
    // sempre do canto superior esquerdo — fica mais natural quando o menu
    // precisa abrir pra cima ou pra esquerda por falta de espaço na tela.
    contextMenuEl.style.transformOrigin = `${left < x ? 'right' : 'left'} ${top < y ? 'bottom' : 'top'}`;
    contextMenuEl.style.left = `${left}px`;
    contextMenuEl.style.top = `${top}px`;
  }

  function syncCheckboxesFromSelection() {
    list.querySelectorAll('.file-row[data-vault-id]').forEach((row) => {
      const checkbox = row.querySelector('.vault-manager-checkbox');
      if (checkbox) checkbox.checked = selected.has(row.dataset.vaultId);
    });
  }

  function showEmptyContextMenu(x, y) {
    openContextMenu(x, y, [
      { label: 'Nova pasta', icon: ICONS.newFolder, onSelect: () => window.vaultWorkspace?.openNewFolderDialog() },
      { label: 'Enviar arquivos', icon: ICONS.upload, onSelect: () => window.vaultWorkspace?.openUploadPicker() },
      'separator',
      { label: 'Atualizar', icon: ICONS.refresh, onSelect: () => window.vaultWorkspace?.refresh() }
    ]);
  }

  function showItemContextMenu(x, y) {
    const rows = [...list.querySelectorAll('.file-row[data-vault-id]')].filter((row) => selected.has(row.dataset.vaultId));
    if (!rows.length) return;
    const hasFolder = rows.some(isFolderRow);
    const single = rows.length === 1 ? rows[0] : null;
    const items = [];
    if (single) {
      items.push(isFolderRow(single)
        ? { label: 'Abrir', icon: ICONS.folder, onSelect: () => single.querySelector('.file-action')?.click() }
        : { label: 'Baixar', icon: ICONS.download, onSelect: () => single.querySelector('.file-action')?.click() });
      items.push('separator');
      items.push({ label: 'Renomear', icon: ICONS.rename, onSelect: () => bulkAction('rename') });
    }
    items.push({ label: 'Mover', icon: ICONS.move, onSelect: () => openMoveDialog([...selected]) });
    items.push({ label: 'Copiar', icon: ICONS.copy, disabled: hasFolder, onSelect: () => bulkAction('copy') });
    items.push('separator');
    items.push({ label: 'Excluir', icon: ICONS.delete, danger: true, onSelect: () => bulkAction('delete') });
    openContextMenu(x, y, items);
  }

  list.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const row = event.target.closest('.file-row[data-vault-id]');
    if (row) {
      if (!selected.has(row.dataset.vaultId)) {
        selected.clear();
        selected.add(row.dataset.vaultId);
        syncCheckboxesFromSelection();
        updateSelection();
      }
      showItemContextMenu(event.clientX, event.clientY);
    } else {
      showEmptyContextMenu(event.clientX, event.clientY);
    }
  });

  document.addEventListener('click', (event) => {
    if (contextMenuEl && !contextMenuEl.hidden && !contextMenuEl.contains(event.target)) closeContextMenu();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeContextMenu(); });
  window.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('resize', closeContextMenu);

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
        checkbox.addEventListener('click', (event) => event.stopPropagation());
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
