import { clearSessionCookie, isSameOrigin, sendJson, setSecurityHeaders } from '../../lib/security.js';

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }
  if (!isSameOrigin(req)) return sendJson(res, 403, { error: 'Origem não permitida.' });
  res.setHeader('Set-Cookie', clearSessionCookie());
  return sendJson(res, 200, { authenticated: false });
}
