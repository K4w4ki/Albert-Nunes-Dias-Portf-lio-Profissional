const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

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
    const status = response.status === 401 || response.status === 403 ? 502 : 502;
    throw new AppError('O Google Drive recusou a operação. Verifique a autorização, a pasta configurada e se a Drive API está habilitada.', status, 'GOOGLE_DRIVE_REQUEST_FAILED');
  }
  return data;
}

export function folderId() {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new AppError('GOOGLE_DRIVE_FOLDER_ID não está configurado corretamente.', 503, 'DRIVE_SETUP_REQUIRED');
  return id;
}

export async function getDirectChildFile(id, accessToken) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) {
    throw new AppError('Arquivo inválido.', 400, 'INVALID_FILE_ID');
  }
  const encodedId = encodeURIComponent(id);
  const data = await driveJson(`${DRIVE_API}/files/${encodedId}?fields=id,name,mimeType,size,modifiedTime,parents,trashed`, accessToken);
  if (data.trashed || !Array.isArray(data.parents) || !data.parents.includes(folderId())) {
    throw new AppError('Arquivo não encontrado nesta pasta privada.', 404, 'FILE_NOT_FOUND');
  }
  return data;
}

export async function beginResumableUpload({ name, mimeType, size }, accessToken, origin) {
  const parent = folderId();
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
      // Sem isso, o envio funciona (o arquivo é gravado), mas o navegador não
      // consegue ler a resposta do PUT e acusa erro mesmo o upload tendo dado certo.
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
