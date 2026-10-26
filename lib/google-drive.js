const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getRedirectUri() {
  const base = process.env.APP_BASE_URL;
  if (!base) throw new AppError('Configure APP_BASE_URL nas variáveis da Vercel.', 503, 'OAUTH_CONFIG_MISSING');
  let url;
  try { url = new URL(base); } catch { throw new AppError('APP_BASE_URL não é uma URL válida.', 503, 'OAUTH_CONFIG_MISSING'); }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new AppError('APP_BASE_URL deve conter somente a URL HTTPS de produção, sem caminho.', 503, 'OAUTH_CONFIG_MISSING');
  }
  return `${url.origin}/api/google/callback`;
}

export function ensureOAuthClientConfig() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new AppError('Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Vercel antes de conectar o Google Drive.', 503, 'OAUTH_CONFIG_MISSING');
  }
  getRedirectUri();
}

export function ensureDriveConfig() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
    throw new AppError('Conclua a conexão inicial com o Google Drive e configure GOOGLE_REFRESH_TOKEN e GOOGLE_DRIVE_FOLDER_ID na Vercel.', 503, 'DRIVE_SETUP_REQUIRED');
  }
}

export async function getAccessToken() {
  ensureDriveConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new AppError('Não foi possível renovar a autorização do Google. Reconecte a conta ou confira as variáveis da Vercel.', 502, 'GOOGLE_TOKEN_FAILED');
  }
  return data.access_token;
}

export async function driveJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError('O Google Drive recusou a operação. Verifique a autorização, a pasta configurada e se a Drive API está habilitada.', 502, 'GOOGLE_DRIVE_REQUEST_FAILED');
  }
  return data;
}

export function folderId() {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new AppError('GOOGLE_DRIVE_FOLDER_ID não está configurado corretamente.', 503, 'DRIVE_SETUP_REQUIRED');
  return id;
}

function isValidId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value);
}

// Sobe a árvore de pastas a partir de startId até achar a raiz do cofre.
// Lança erro se sair do cofre, estiver na lixeira, ou a árvore for funda demais.
// Retorna a cadeia de ids percorrida (incluindo startId e a raiz), do mais fundo ao mais raso.
async function ancestorChain(startId, token) {
  const root = folderId();
  const chain = [startId];
  let current = startId;
  for (let hops = 0; hops < 25; hops++) {
    if (current === root) return chain;
    const data = await driveJson(`${DRIVE_API}/files/${encodeURIComponent(current)}?fields=id,parents,trashed`, token);
    if (data.trashed) throw new AppError('Pasta não encontrada neste cofre.', 404, 'FOLDER_NOT_FOUND');
    const parents = Array.isArray(data.parents) ? data.parents : [];
    if (!parents.length) throw new AppError('Pasta não encontrada neste cofre.', 404, 'FOLDER_NOT_FOUND');
    current = parents[0];
    chain.push(current);
  }
  throw new AppError('Estrutura de pastas muito profunda.', 400, 'FOLDER_TOO_DEEP');
}

// Confirma que um id de pasta é válido, é de fato uma pasta, e está dentro do cofre
// (raiz ou alguma subpasta dela). Retorna o id (a raiz, se nada for informado).
export async function resolveVaultFolder(id, token) {
  const root = folderId();
  if (!id) return root;
  if (id === root) return root;
  if (!isValidId(id)) throw new AppError('Pasta inválida.', 400, 'INVALID_FOLDER_ID');
  const data = await driveJson(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,mimeType,trashed`, token);
  if (data.trashed || data.mimeType !== FOLDER_MIME) throw new AppError('Pasta inválida.', 400, 'INVALID_FOLDER_ID');
  await ancestorChain(id, token);
  return id;
}

// Busca um arquivo (ou pasta) garantindo que seu pai esteja dentro do cofre.
export async function getVaultFile(id, token) {
  if (!isValidId(id)) throw new AppError('Arquivo inválido.', 400, 'INVALID_FILE_ID');
  const data = await driveJson(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,parents,trashed`, token);
  if (data.trashed) throw new AppError('Arquivo não encontrado neste cofre.', 404, 'FILE_NOT_FOUND');
  const parent = Array.isArray(data.parents) ? data.parents[0] : null;
  if (!parent) throw new AppError('Arquivo não encontrado neste cofre.', 404, 'FILE_NOT_FOUND');
  await ancestorChain(parent, token);
  return data;
}

export async function createFolder({ name, parentId }, token) {
  const parent = await resolveVaultFolder(parentId, token);
  return driveJson(`${DRIVE_API}/files?fields=id,name,mimeType,size,modifiedTime`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] })
  });
}

export async function moveItem({ id, destinationId }, token) {
  const item = await getVaultFile(id, token);
  const destination = await resolveVaultFolder(destinationId, token);
  const currentParent = item.parents[0];
  if (destination === currentParent) throw new AppError('O item já está nesta pasta.', 400, 'SAME_FOLDER');
  if (item.mimeType === FOLDER_MIME) {
    if (destination === item.id) throw new AppError('Não é possível mover uma pasta para dentro dela mesma.', 400, 'INVALID_DESTINATION');
    const destinationChain = await ancestorChain(destination, token);
    if (destinationChain.includes(item.id)) {
      throw new AppError('Não é possível mover uma pasta para dentro de uma subpasta dela mesma.', 400, 'INVALID_DESTINATION');
    }
  }
  return driveJson(
    `${DRIVE_API}/files/${encodeURIComponent(id)}?addParents=${encodeURIComponent(destination)}&removeParents=${encodeURIComponent(currentParent)}&fields=id,name,mimeType,size,modifiedTime,parents`,
    token,
    { method: 'PATCH' }
  );
}

export async function beginResumableUpload({ name, mimeType, size, parentId }, accessToken, origin) {
  const parent = parentId || folderId();
  const url = `${UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,size,modifiedTime`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(size),
      // O Google só libera CORS no PUT que o navegador faz depois, direto para
      // googleapis.com, se este Origin já tiver sido declarado na criação da sessão.
      ...(origin ? { Origin: origin } : {})
    },
    body: JSON.stringify({ name, mimeType, parents: [parent] })
  });
  if (!response.ok) throw new AppError('Não foi possível iniciar o envio para o Google Drive.', 502, 'UPLOAD_INIT_FAILED');
  const location = response.headers.get('location');
  if (!location || !location.startsWith('https://www.googleapis.com/upload/drive/v3/files?')) {
    throw new AppError('O Google não retornou uma sessão de envio válida.', 502, 'UPLOAD_SESSION_INVALID');
  }
  return location;
}
