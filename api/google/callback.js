import crypto from 'node:crypto';
import { htmlEscape, isAdmin, sendJson, setSecurityHeaders, validOAuthState, OAUTH_STATE_COOKIE } from '../../lib/security.js';
import { driveJson, getRedirectUri } from '../../lib/google-drive.js';

function htmlPage(res, title, message, content = '') {
  const nonce = crypto.randomBytes(16).toString('base64');
  setSecurityHeaders(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.statusCode = 200;
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#060b1b;color:#eaf0ff;font:16px/1.5 Inter,system-ui,sans-serif}.panel{width:min(760px,100%);padding:28px;border:1px solid #2a3b62;border-radius:20px;background:linear-gradient(145deg,#101a35,#080f22);box-shadow:0 24px 70px #0008}h1{font-size:1.65rem;margin:0 0 10px}p{color:#aebdd9}.field{margin:20px 0}label{display:block;font-size:.82rem;color:#8ea5cd;margin-bottom:7px}textarea{width:100%;height:84px;background:#050916;color:#a9f0cd;border:1px solid #2c426d;border-radius:10px;padding:12px;resize:vertical;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}button,a{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:999px;padding:11px 16px;background:#f57c00;color:white;text-decoration:none;font-weight:700;cursor:pointer}.warn{padding:12px 14px;border-radius:10px;background:#3c2716;border:1px solid #7d4b20;color:#ffd6a8;margin-top:18px;font-size:.9rem}.ok{color:#9ce5bc}.muted{font-size:.88rem}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.copy{background:#1a3765}.hidden{display:none}
  </style></head><body><main class="panel"><h1>${htmlEscape(title)}</h1><p>${htmlEscape(message)}</p>${content}</main><script nonce="${nonce}">
  document.querySelectorAll('[data-copy]').forEach(btn=>btn.addEventListener('click',async()=>{const el=document.getElementById(btn.dataset.copy);try{await navigator.clipboard.writeText(el.value);btn.textContent='Copiado';}catch{el.focus();el.select();btn.textContent='Selecione e copie';}}));
  try{history.replaceState(null,'',location.pathname);}catch{}
  </script></body></html>`);
}

function clearState(res) {
  res.setHeader('Set-Cookie', `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }
  const query = req.query || {};
  if (!isAdmin(req)) {
    clearState(res);
    return htmlPage(res, 'Sessão expirada', 'Entre novamente no painel privado e inicie a conexão com o Google Drive.');
  }
  if (query.error) {
    clearState(res);
    return htmlPage(res, 'Autorização não concluída', 'O acesso ao Google Drive foi cancelado ou recusado. Volte ao painel e tente novamente.');
  }
  const state = typeof query.state === 'string' ? query.state : '';
  if (!validOAuthState(req, state)) {
    clearState(res);
    return htmlPage(res, 'Conexão expirada', 'A verificação de segurança expirou ou não corresponde ao início da conexão. Volte ao painel e tente novamente.');
  }

  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error('Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Vercel e faça um novo deploy.');
    const code = typeof query.code === 'string' ? query.code : '';
    if (!code) throw new Error('O Google não retornou um código de autorização.');
    const tokensResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: getRedirectUri(),
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokensResponse.json().catch(() => ({}));
    if (!tokensResponse.ok || !tokens.access_token) throw new Error('O Google não aceitou o código de autorização. Confira o Client ID, o segredo e o URI de redirecionamento.');
    if (!tokens.refresh_token) throw new Error('O Google não forneceu um refresh token. Remova o acesso do app nas configurações da Conta Google e repita a conexão com prompt de consentimento.');

    // Reaproveita a pasta previamente criada por este app, se houver; senão cria a pasta dedicada.
    const q = encodeURIComponent("name = 'Albert Private Vault' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const found = await driveJson(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=20&fields=files(id,name,mimeType)`, tokens.access_token);
    let driveFolder = found.files?.[0];
    if (!driveFolder) {
      driveFolder = await driveJson('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType', tokens.access_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name: 'Albert Private Vault', mimeType: 'application/vnd.google-apps.folder' })
      });
    }
    clearState(res);
    const content = `<p class="ok">A autorização foi concluída. A pasta dedicada <strong>Albert Private Vault</strong> está pronta.</p>
      <div class="field"><label for="refreshToken">GOOGLE_REFRESH_TOKEN — segredo, não publique</label><textarea id="refreshToken" readonly>${htmlEscape(tokens.refresh_token)}</textarea><button class="copy" data-copy="refreshToken" type="button">Copiar token</button></div>
      <div class="field"><label for="folderId">GOOGLE_DRIVE_FOLDER_ID</label><textarea id="folderId" readonly>${htmlEscape(driveFolder.id)}</textarea><button class="copy" data-copy="folderId" type="button">Copiar ID da pasta</button></div>
      <div class="warn">O token é uma credencial privada. Não o envie por mensagem nem o coloque no GitHub. Copie-o diretamente para Vercel → Settings → Environment Variables. Depois, feche esta página.</div>
      <div class="actions"><a href="/privado.html">Voltar ao painel</a></div>`;
    return htmlPage(res, 'Google Drive conectado', 'Copie os dois valores abaixo para as variáveis de ambiente da Vercel. Eles não são gravados no repositório.', content);
  } catch (error) {
    clearState(res);
    return htmlPage(res, 'Falha na conexão', error.message || 'Não foi possível concluir a autorização. Confira a configuração do Google Cloud e tente novamente.');
  }
}
