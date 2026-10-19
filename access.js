(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const trigger = document.getElementById('vaultTrigger');
    const dialog = document.getElementById('vaultDialog');
    const close = document.getElementById('vaultDialogClose');
    const form = document.getElementById('vaultLoginForm');
    const password = document.getElementById('vaultPassword');
    const error = document.getElementById('vaultLoginError');
    const submit = document.getElementById('vaultLoginSubmit');
    if (!trigger || !dialog || !form || !password || !error || !submit) return;

    const showError = (message) => {
      error.textContent = message;
      error.hidden = false;
    };
    const clearError = () => {
      error.textContent = '';
      error.hidden = true;
    };

    trigger.addEventListener('click', () => {
      clearError();
      password.value = '';
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else window.location.href = '/privado.html';
      window.setTimeout(() => password.focus(), 30);
    });
    close?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearError();
      submit.disabled = true;
      submit.textContent = 'Verificando…';
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          body: JSON.stringify({ password: password.value })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível autenticar. Tente novamente.');
        window.location.assign('/privado.html');
      } catch (err) {
        showError(err.message || 'Falha de conexão. Tente novamente.');
      } finally {
        submit.disabled = false;
        submit.innerHTML = 'Desbloquear <span aria-hidden="true">↗</span>';
      }
    });
  });
})();
