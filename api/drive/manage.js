import { AppError, FOLDER_MIME, createFolder, driveJson, getAccessToken, getVaultFile, moveItem } from '../../lib/google-drive.js';
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
    const token = await getAccessToken();

    if (action === 'create-folder') {
      const name = cleanName(body.name);
      if (!name) throw new AppError('Informe um nome para a pasta.', 400, 'INVALID_FILE_NAME');
      const parentId = typeof body.parentId === 'string' ? body.parentId : '';
      const folder = await createFolder({ name, parentId }, token);
      return sendJson(res, 200, { success: true, file: folder });
    }

    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) throw new AppError('Selecione um item válido.', 400, 'INVALID_FILE_ID');

    if (action === 'rename') {
      const name = cleanName(body.name);
      if (!name) throw new AppError('Informe um nome válido.', 400, 'INVALID_FILE_NAME');
      await getVaultFile(id, token); // garante que o item pertence a este cofre
      const updated = await driveJson(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      return sendJson(res, 200, { success: true, file: updated });
    }

    if (action === 'copy') {
      const file = await getVaultFile(id, token);
      if (file.mimeType === FOLDER_MIME) throw new AppError('Não é possível copiar pastas, apenas arquivos.', 400, 'FOLDER_COPY_UNSUPPORTED');
      const name = cleanName(body.name) || `Cópia de ${file.name}`;
      const copied = await driveJson(`${DRIVE_API}/files/${encodeURIComponent(id)}/copy?fields=id,name,mimeType,size,modifiedTime`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parents: [file.parents[0]] })
      });
      return sendJson(res, 200, { success: true, file: copied });
    }

    if (action === 'move') {
      const destinationId = typeof body.destinationId === 'string' ? body.destinationId : '';
      const updated = await moveItem({ id, destinationId }, token);
      return sendJson(res, 200, { success: true, file: updated });
    }

    if (action === 'delete') {
      await getVaultFile(id, token);
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
