import { isAdmin, sendJson, setSecurityHeaders } from '../../lib/security.js';

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }
  if (!isAdmin(req)) return sendJson(res, 401, { authenticated: false, error: 'Entre para acessar a área privada.', code: 'UNAUTHENTICATED' });
  return sendJson(res, 200, { authenticated: true });
}
