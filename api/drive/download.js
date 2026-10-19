import { Readable } from 'node:stream';
import { AppError, getAccessToken, getDirectChildFile } from '../../lib/google-drive.js';
import { requireAdmin, sendJson, setSecurityHeaders } from '../../lib/security.js';

const EXPORTS = {
  'application/vnd.google-apps.document': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx' },
  'application/vnd.google-apps.presentation': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: '.png' }
};

function contentDisposition(fileName) {
  const safe = String(fileName || 'download').replace(/[\r\n\\"]/g, '_');
  return `attachment; filename="${safe.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }
  if (!requireAdmin(req, res)) return;
  try {
    const fileId = typeof req.query?.id === 'string' ? req.query.id : '';
    if (!fileId) throw new AppError('Faltou o ID do arquivo.', 400, 'INVALID_FILE_ID');
    const token = await getAccessToken();
    const file = await getDirectChildFile(fileId, token);
    const googleExport = EXPORTS[file.mimeType];
    const downloadName = googleExport && !file.name.toLowerCase().endsWith(googleExport.extension) ? `${file.name}${googleExport.extension}` : file.name;
    const url = googleExport
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(googleExport.mimeType)}`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`;
    const upstream = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!upstream.ok || !upstream.body) throw new AppError('O Google Drive não conseguiu fornecer o conteúdo do arquivo.', 502, 'DOWNLOAD_FAILED');

    res.statusCode = 200;
    res.setHeader('Content-Type', googleExport ? googleExport.mimeType : (file.mimeType || 'application/octet-stream'));
    res.setHeader('Content-Disposition', contentDisposition(downloadName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (!googleExport && file.size) res.setHeader('Content-Length', String(file.size));
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    return sendJson(res, error.status || 502, { error: error.message || 'Não foi possível baixar este arquivo.', code: error.code || 'DOWNLOAD_FAILED' });
  }
}
