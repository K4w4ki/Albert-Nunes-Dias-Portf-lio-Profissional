import { AppError, driveJson, folderId, getAccessToken } from '../../lib/google-drive.js';
import { requireAdmin, sendJson, setSecurityHeaders } from '../../lib/security.js';

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }
  if (!requireAdmin(req, res)) return;
  try {
    const token = await getAccessToken();
    const parent = folderId();
    const q = encodeURIComponent(`'${parent}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`);
    const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,modifiedTime)');
    const pageToken = typeof req.query?.pageToken === 'string' && req.query.pageToken.length < 2048 ? `&pageToken=${encodeURIComponent(req.query.pageToken)}` : '';
    const data = await driveJson(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&orderBy=name&fields=${fields}${pageToken}`, token);
    return sendJson(res, 200, { files: Array.isArray(data.files) ? data.files : [], nextPageToken: data.nextPageToken || null });
  } catch (error) {
    return sendJson(res, error.status || 502, { error: error.message || 'Não foi possível listar os arquivos.', code: error.code || 'DRIVE_LIST_FAILED' });
  }
}
