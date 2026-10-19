import crypto from 'node:crypto';
import { clearLoginFailures, createSessionCookie, isSameOrigin, loginBlocked, recordLoginFailure, sendJson, setSecurityHeaders } from '../../lib/security.js';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }
  if (!isSameOrigin(req)) return sendJson(res, 403, { error: 'Origem não permitida.' });
  if (loginBlocked(req)) return sendJson(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.' });

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 12) return sendJson(res, 503, { error: 'A senha de administração ainda não foi configurada corretamente na Vercel.' });
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) return sendJson(res, 503, { error: 'SESSION_SECRET não está configurado. Adicione uma chave aleatória com pelo menos 32 caracteres na Vercel.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const supplied = typeof body?.password === 'string' ? body.password : '';
  if (!supplied || supplied.length > 512) {
    recordLoginFailure(req);
    return sendJson(res, 401, { error: 'Senha incorreta.' });
  }

  // Comparação de digests de tamanho fixo para reduzir vazamento por tempo de comparação.
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  const suppliedDigest = crypto.createHash('sha256').update(supplied).digest();
  if (!crypto.timingSafeEqual(expectedDigest, suppliedDigest)) {
    recordLoginFailure(req);
    return sendJson(res, 401, { error: 'Senha incorreta.' });
  }

  clearLoginFailures(req);
  res.setHeader('Set-Cookie', createSessionCookie());
  return sendJson(res, 200, { authenticated: true });
}
