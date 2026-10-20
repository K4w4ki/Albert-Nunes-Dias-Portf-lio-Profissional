import { AppError, beginResumableUpload, getAccessToken } from '../../lib/google-drive.js';
import { isSameOrigin, parseJsonBody, requireAdmin, sendJson, setSecurityHeaders } from '../../lib/security.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024 * 1024; // Limite nominal de 5 TiB do Drive.

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

function cleanFileName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 180);
}

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }
  if (!isSameOrigin(req)) return sendJson(res, 403, { error: 'Origem não permitida.' });
  if (!requireAdmin(req, res)) return;
  try {
    const body = parseJsonBody(req);
    const name = cleanFileName(body.name);
    const mimeType = typeof body.mimeType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(body.mimeType) ? body.mimeType : 'application/octet-stream';
    const size = Number(body.size);
    if (!name) throw new AppError('O arquivo precisa ter um nome válido.', 400, 'INVALID_FILE_NAME');
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_SIZE) throw new AppError('Tamanho de arquivo inválido ou acima do limite do Google Drive.', 400, 'INVALID_FILE_SIZE');

    const accessToken = await getAccessToken();
    const uploadUrl = await beginResumableUpload({ name, mimeType, size }, accessToken, req.headers.origin);
    return sendJson(res, 200, { uploadUrl, name });
  } catch (error) {
    return sendJson(res, error.status || 502, { error: error.message || 'Não foi possível preparar o envio.', code: error.code || 'UPLOAD_INIT_FAILED' });
  }
}
