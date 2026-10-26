(() => {
  const $ = (selector) => document.querySelector(selector);
  const loginPanel = $('#loginPanel');
  const setupPanel = $('#setupPanel');
  const workspace = $('#workspace');
  const loginForm = $('#privateLoginForm');
  const passwordInput = $('#privatePassword');
  const loginButton = $('#privateLoginButton');
  const loginMessage = $('#loginMessage');
  const fileInput = $('#fileInput');
  const uploadButton = $('#uploadButton');
  const uploadProgressWrap = $('#uploadProgressWrap');
  const uploadProgressFill = $('#uploadProgressFill');
  const uploadStatus = $('#uploadStatus');
  const uploadPercent = $('#uploadPercent');
  const workspaceMessage = $('#workspaceMessage');
  const fileList = $('#fileList');
  const fileCount = $('#fileCount');
  const refreshButton = $('#refreshButton');
  const loadMoreButton = $('#loadMoreButton');
  const newFolderButton = $('#newFolderButton');
  const newFolderDialog = $('#newFolderDialog');
  const newFolderForm = $('#newFolderForm');
  const newFolderNameInput = $('#newFolderNameInput');
  const breadcrumbEl = $('#breadcrumb');
  const navBackButton = $('#navBackButton');
  const navForwardButton = $('#navForwardButton');
  const FOLDER_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  let selectedFiles = [];
  let nextPageToken = null;
  let loadedCount = 0;
  let toastTimer = null;
  let rootFolderId = null;
  let currentFolderId = null;
  let breadcrumbPath = []; // [{ id, name }]
  let navHistory = []; // pilha de breadcrumbPaths visitados (para o botão Voltar)
  let navFuture = []; // pilha de breadcrumbPaths "desfeitos" (para o botão Avançar)

  function showPanel(panel) {
    loginPanel.hidden = panel !== 'login';
    setupPanel.hidden = panel !== 'setup';
    workspace.hidden = panel !== 'workspace';
  }

  function showLoginError(message) {
    loginMessage.textContent = message;
    loginMessage.hidden = false;
  }

  function setWorkspaceMessage(message, isError = false) {
    workspaceMessage.textContent = message;
    workspaceMessage.classList.toggle('is-error', isError);
    workspaceMessage.hidden = !message;
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4200);
  }

  async function jsonRequest(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      showPanel('login');
      throw new Error(data.error || 'Sua sessão expirou. Entre novamente.');
    }
    if (!response.ok) {
      const error = new Error(data.error || 'A operação falhou. Tente novamente.');
      error.code = data.code;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value === 0) return '0 bytes';
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const rounded = value / (1024 ** index);
    return `${rounded.toLocaleString('pt-BR', { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
  }

  function prettyDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function extension(name) {
    const match = String(name).match(/\.([a-z\d]{1,6})$/i);
    return (match ? match[1] : 'FILE').toUpperCase();
  }

  // --- Breadcrumb ---

  function renderBreadcrumb() {
    breadcrumbEl.replaceChildren();
    breadcrumbPath.forEach((crumb, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'vault-breadcrumb-sep';
        sep.textContent = '/';
        breadcrumbEl.append(sep);
      }
      if (index === breadcrumbPath.length - 1) {
        const current = document.createElement('span');
        current.className = 'vault-breadcrumb-current';
        current.textContent = crumb.name;
        breadcrumbEl.append(current);
      } else {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'vault-breadcrumb-link';
        link.textContent = crumb.name;
        link.addEventListener('click', () => openFolder(crumb.id, crumb.name, breadcrumbPath.slice(0, index + 1)));
        breadcrumbEl.append(link);
      }
    });
  }

  function updateNavButtons() {
    navBackButton.disabled = navHistory.length === 0;
    navForwardButton.disabled = navFuture.length === 0;
  }

  async function openFolder(folderId, folderName, trail) {
    // Navegação "nova" (clicar numa pasta ou num item do breadcrumb): empilha o
    // estado atual no histórico e descarta o que havia pra frente, como num navegador.
    if (breadcrumbPath.length) {
      navHistory.push(breadcrumbPath);
      navFuture = [];
    }
    currentFolderId = folderId;
    breadcrumbPath = trail || [...breadcrumbPath, { id: folderId, name: folderName }];
    renderBreadcrumb();
    updateNavButtons();
    await loadFiles(false);
  }

  async function goTo(path) {
    currentFolderId = path[path.length - 1].id;
    breadcrumbPath = path;
    renderBreadcrumb();
    updateNavButtons();
    await loadFiles(false);
  }

  navBackButton.addEventListener('click', async () => {
    if (!navHistory.length) return;
    const previous = navHistory.pop();
    navFuture.push(breadcrumbPath);
    await goTo(previous);
  });

  navForwardButton.addEventListener('click', async () => {
    if (!navFuture.length) return;
    const next = navFuture.pop();
    navHistory.push(breadcrumbPath);
    await goTo(next);
  });

  // --- File list rendering ---

  function renderFile(file) {
    const isFolder = file.mimeType === FOLDER_MIME;
    const row = document.createElement('article');
    row.className = 'file-row' + (isFolder ? ' is-folder' : '');
    row.dataset.vaultId = file.id;
    row.dataset.vaultType = isFolder ? 'folder' : 'file';

    const info = document.createElement('div');
    info.className = 'file-info';
    const icon = document.createElement('span');
    icon.className = 'file-type-icon' + (isFolder ? ' is-folder' : '');
    icon.setAttribute('aria-hidden', 'true');
    if (isFolder) icon.innerHTML = FOLDER_ICON_SVG;
    else icon.textContent = extension(file.name);
    const nameWrap = document.createElement('div');
    nameWrap.className = 'file-name-wrap';
    const name = document.createElement('strong');
    name.className = 'file-name';
    name.textContent = file.name || (isFolder ? 'Pasta sem nome' : 'Arquivo sem nome');
    name.title = file.name || '';
    const size = document.createElement('small');
    size.className = 'file-size';
    size.textContent = isFolder ? 'Pasta' : formatBytes(file.size);
    nameWrap.append(name, size);
    info.append(icon, nameWrap);

    const type = document.createElement('span');
    type.className = 'file-type';
    type.textContent = isFolder
      ? 'Pasta'
      : (file.mimeType || 'application/octet-stream').replace('application/vnd.openxmlformats-officedocument.', '').replace('application/', '').replace('image/', 'imagem/').replace('text/', 'texto/');
    type.title = isFolder ? '' : (file.mimeType || '');

    const date = document.createElement('time');
    date.className = 'file-date';
    date.textContent = prettyDate(file.modifiedTime);
    if (file.modifiedTime) date.dateTime = file.modifiedTime;

    let action;
    if (isFolder) {
      action = document.createElement('button');
      action.type = 'button';
      action.className = 'file-action';
      action.textContent = 'Abrir';
      action.addEventListener('click', (event) => {
        event.stopPropagation();
        openFolder(file.id, file.name || 'Pasta');
      });
    } else {
      action = document.createElement('a');
      action.className = 'file-action';
      action.href = `/api/drive/download?id=${encodeURIComponent(file.id)}`;
      action.setAttribute('aria-label', `Baixar ${file.name || 'arquivo'}`);
      action.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v3h16v-3"/></svg> Baixar';
    }

    row.append(info, type, date, action);
    if (isFolder) {
      row.addEventListener('click', (event) => {
        if (event.target.closest('.file-action') || event.target.closest('.vault-manager-checkbox')) return;
        openFolder(file.id, file.name || 'Pasta');
      });
    }
    return row;
  }

  function showEmptyState() {
    fileList.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const headline = document.createElement('strong');
    headline.textContent = 'Esta pasta ainda está vazia';
    const detail = document.createElement('span');
    detail.textContent = 'Envie um arquivo ou crie uma subpasta para começar.';
    empty.append(headline, detail);
    fileList.append(empty);
  }

  async function loadFiles(append = false) {
    if (!append) {
      nextPageToken = null;
      loadedCount = 0;
      fileList.innerHTML = '<div class="loading-state"><span class="spinner"></span> Consultando o Drive…</div>';
      loadMoreButton.hidden = true;
    } else {
      loadMoreButton.disabled = true;
      loadMoreButton.textContent = 'Carregando…';
    }
    try {
      const params = new URLSearchParams();
      if (append && nextPageToken) params.set('pageToken', nextPageToken);
      if (currentFolderId) params.set('folderId', currentFolderId);
      const query = params.toString() ? `?${params.toString()}` : '';
      const result = await jsonRequest(`/api/drive/list${query}`);
      if (!rootFolderId) rootFolderId = result.folderId;
      if (!currentFolderId) {
        currentFolderId = result.folderId;
        breadcrumbPath = [{ id: rootFolderId, name: 'Meus arquivos' }];
        renderBreadcrumb();
      }
      const files = Array.isArray(result.files) ? result.files : [];
      if (!append) fileList.replaceChildren();
      files.forEach((file) => fileList.append(renderFile(file)));
      loadedCount += files.length;
      nextPageToken = result.nextPageToken || null;
      fileCount.textContent = String(loadedCount);
      loadMoreButton.hidden = !nextPageToken;
      if (!loadedCount) showEmptyState();
      setWorkspaceMessage('');
    } catch (error) {
      if (error.code === 'DRIVE_SETUP_REQUIRED' || error.code === 'OAUTH_CONFIG_MISSING') {
        showPanel('setup');
      } else if (error.code !== 'UNAUTHENTICATED') {
        fileList.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        const headline = document.createElement('strong');
        headline.textContent = 'Não foi possível acessar o Drive';
        const detail = document.createElement('span');
        detail.textContent = error.message || 'Confira a configuração e tente novamente.';
        empty.append(headline, detail);
        fileList.append(empty);
        showPanel('workspace');
      }
    } finally {
      loadMoreButton.disabled = false;
      loadMoreButton.textContent = 'Carregar mais arquivos';
    }
  }

  async function startSession() {
    try {
      const response = await jsonRequest('/api/auth/me');
      if (response.authenticated) {
        showPanel('workspace');
        await loadFiles();
      } else showPanel('login');
    } catch (error) {
      if (error.code !== 'UNAUTHENTICATED') {
        showPanel('login');
        showLoginError(error.message || 'Não foi possível verificar a sessão.');
      }
    }
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginMessage.hidden = true;
    loginButton.disabled = true;
    loginButton.innerHTML = 'Verificando…';
    try {
      await jsonRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput.value })
      });
      passwordInput.value = '';
      showPanel('workspace');
      currentFolderId = null;
      breadcrumbPath = [];
      navHistory = [];
      navFuture = [];
      updateNavButtons();
      await loadFiles();
    } catch (error) {
      showLoginError(error.message || 'Não foi possível entrar.');
    } finally {
      loginButton.disabled = false;
      loginButton.innerHTML = 'Entrar <span aria-hidden="true">→</span>';
    }
  });

  $('#logoutButton').addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch {}
    window.location.assign('/');
  });

  $('#refreshButton').addEventListener('click', async () => {
    refreshButton.disabled = true;
    await loadFiles();
    refreshButton.disabled = false;
  });
  loadMoreButton.addEventListener('click', () => loadFiles(true));

  function openNewFolderDialog() {
    newFolderForm.reset();
    newFolderDialog.showModal();
    window.setTimeout(() => newFolderNameInput.focus(), 30);
  }

  newFolderButton.addEventListener('click', openNewFolderDialog);
  $('#newFolderDialogClose')?.addEventListener('click', () => newFolderDialog.close());
  newFolderDialog.addEventListener('click', (event) => {
    if (event.target === newFolderDialog) newFolderDialog.close();
  });

  newFolderForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const trimmed = newFolderNameInput.value.trim();
    if (!trimmed) return;
    const submitButton = newFolderForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Criando…';
    try {
      await jsonRequest('/api/drive/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-folder', name: trimmed, parentId: currentFolderId })
      });
      newFolderDialog.close();
      setWorkspaceMessage('Pasta criada com sucesso.');
      await loadFiles();
    } catch (error) {
      setWorkspaceMessage(error.message || 'Não foi possível criar a pasta.', true);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Criar pasta';
    }
  });

  fileInput.addEventListener('change', () => {
    selectedFiles = Array.from(fileInput.files || []);
    uploadButton.disabled = selectedFiles.length === 0;
    uploadButton.innerHTML = selectedFiles.length ? `Enviar ${selectedFiles.length} arquivo${selectedFiles.length > 1 ? 's' : ''} <span aria-hidden="true">↑</span>` : 'Enviar <span aria-hidden="true">↑</span>';
    setWorkspaceMessage(selectedFiles.length ? `${selectedFiles.length} arquivo(s) selecionado(s).` : '');
  });

  function uploadFileToGoogle(sessionUrl, file, progressCallback) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', sessionUrl, true);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) progressCallback(event.loaded / event.total);
      });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`O Google Drive respondeu com erro (${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error('Falha de rede durante o envio. Tente novamente.'));
      xhr.onabort = () => reject(new Error('Envio cancelado.'));
      xhr.send(file);
    });
  }

  uploadButton.addEventListener('click', async () => {
    if (!selectedFiles.length) return;
    uploadButton.disabled = true;
    refreshButton.disabled = true;
    uploadProgressWrap.hidden = false;
    setWorkspaceMessage('');
    let completed = 0;
    try {
      for (const file of selectedFiles) {
        uploadStatus.textContent = `Enviando ${file.name}`;
        uploadPercent.textContent = '0%';
        uploadProgressFill.style.width = '0%';
        const session = await jsonRequest('/api/drive/upload-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, folderId: currentFolderId })
        });
        await uploadFileToGoogle(session.uploadUrl, file, (fraction) => {
          uploadProgressFill.style.width = `${Math.round(fraction * 100)}%`;
          uploadPercent.textContent = `${Math.round(fraction * 100)}%`;
        });
        completed += 1;
      }
      uploadStatus.textContent = 'Envio concluído';
      uploadPercent.textContent = '100%';
      uploadProgressFill.style.width = '100%';
      fileInput.value = '';
      selectedFiles = [];
      uploadButton.innerHTML = 'Enviar <span aria-hidden="true">↑</span>';
      setWorkspaceMessage(`${completed} arquivo(s) enviado(s) com sucesso.`);
      await loadFiles();
      showToast('Arquivos enviados.');
    } catch (error) {
      setWorkspaceMessage(error.message || 'O envio falhou. Confira a conexão e tente novamente.', true);
      uploadStatus.textContent = 'Envio interrompido';
    } finally {
      uploadButton.disabled = selectedFiles.length === 0;
      refreshButton.disabled = false;
    }
  });

  // Canvas de estrelas discreto; roda sempre (ver privado.css para o motivo).
  const canvas = $('#starfield');
  const context = canvas?.getContext('2d');
  if (canvas && context) {
    let stars = [];
    let raf = null;
    const reducedMotion = false;
    function resizeStars() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.min(180, Math.floor((window.innerWidth * window.innerHeight) / 7500)) }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.2 + .2,
        alpha: Math.random() * .4 + .12,
        drift: (Math.random() - .5) * .12
      }));
      drawStars();
    }
    function drawStars() {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const star of stars) {
        context.fillStyle = `rgba(192,210,255,${star.alpha})`;
        context.beginPath();
        context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        context.fill();
        if (!reducedMotion) {
          star.y += .07;
          star.x += star.drift;
          if (star.y > window.innerHeight) star.y = 0;
          if (star.x < 0) star.x = window.innerWidth;
          if (star.x > window.innerWidth) star.x = 0;
        }
      }
      if (!reducedMotion) raf = requestAnimationFrame(drawStars);
    }
    window.addEventListener('resize', resizeStars, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && raf) cancelAnimationFrame(raf);
      else if (!document.hidden && !reducedMotion) drawStars();
    });
    resizeStars();
  }

  // Exposto para privado-manager.js (toolbar de seleção em massa / mover / menu de contexto).
  window.vaultWorkspace = {
    getFolderId: () => currentFolderId,
    getRootId: () => rootFolderId,
    refresh: () => loadFiles(false),
    openNewFolderDialog,
    openUploadPicker: () => fileInput.click()
  };

  startSession();
})();
