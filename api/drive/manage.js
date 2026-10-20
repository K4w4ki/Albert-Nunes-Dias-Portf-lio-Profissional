import { AppError, driveJson, folderId, getAccessToken, getDirectChildFile } from '../../lib/google-drive.js';
import { isSameOrigin, parseJsonBody, requireAdmin, sendJson, setSecurityHeaders } from '../../lib/security.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

function cleanName(value) {
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
    const action = typeof body.action === 'string' ? body.action : '';
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) throw new AppError('Selecione um arquivo válido.', 400, 'INVALID_FILE_ID');

    const token = await getAccessToken();
    // Restringe as operações a arquivos diretamente dentro da pasta privada configurada.
    const file = await getDirectChildFile(id, token);

    if (action === 'rename') {
      const name = cleanName(body.name);
      if (!name) throw new AppError('Informe um nome válido.', 400, 'INVALID_FILE_NAME');
      const updated = await driveJson(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      return sendJson(res, 200, { success: true, file: updated });
    }

    if (action === 'copy') {
      const name = cleanName(body.name) || `Cópia de ${file.name}`;
      const copied = await driveJson(`${DRIVE_API}/files/${encodeURIComponent(id)}/copy?fields=id,name,mimeType,size,modifiedTime`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parents: [folderId()] })
      });
      return sendJson(res, 200, { success: true, file: copied });
    }

    if (action === 'delete') {
      await driveJson(`${DRIVE_API}/files/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
      return sendJson(res, 200, { success: true, deletedId: id });
    }

    throw new AppError('Ação não reconhecida.', 400, 'INVALID_ACTION');
  } catch (error) {
    return sendJson(res, error.status || 502, {
      error: error.message || 'Não foi possível concluir a operação.',
      code: error.code || 'DRIVE_MANAGE_FAILED'
    });
  }
}
