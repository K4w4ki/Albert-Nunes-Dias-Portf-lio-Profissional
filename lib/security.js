import crypto from 'node:crypto';

export const SESSION_COOKIE = '__Host-albert-vault';
export const OAUTH_STATE_COOKIE = '__Host-albert-google-state';
const SESSION_SECONDS = 8 * 60 * 60;

export function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

export function sendJson(res, status, payload) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET_MISSING');
  return secret;
}

function hmac(value) {
  return crypto.createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const cookies = Object.create(null);
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      try { cookies[key] = decodeURIComponent(value); } catch { cookies[key] = value; }
    }
  }
  return cookies;
}

export function createSessionCookie() {
  const payload = Buffer.from(JSON.stringify({ sub: 'admin', exp: Date.now() + SESSION_SECONDS * 1000 })).toString('base64url');
  const token = `${payload}.${hmac(payload)}`;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function isAdmin(req) {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return false;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return false;
    if (!safeEqual(signature, hmac(payload))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.sub === 'admin' && Number.isFinite(data.exp) && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  sendJson(res, 401, { error: 'Sessão expirada. Entre novamente.', code: 'UNAUTHENTICATED' });
  return false;
}

export function isSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === String(host).toLowerCase() && parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Proteção básica por processo. Em produção, complemente com rate limiting no WAF da Vercel.
const loginFailures = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILURES = 5;

export function loginBlocked(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const record = loginFailures.get(ip);
  if (!record) return false;
  if (record.until <= Date.now()) { loginFailures.delete(ip); return false; }
  return record.count >= RATE_MAX_FAILURES;
}

export function recordLoginFailure(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const record = loginFailures.get(ip);
  if (!record || record.until <= now) loginFailures.set(ip, { count: 1, until: now + RATE_WINDOW_MS });
  else record.count += 1;
}

export function clearLoginFailures(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  loginFailures.delete(ip);
}

export function newOAuthState() {
  const state = crypto.randomBytes(32).toString('hex');
  return { state, cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(`${state}.${hmac(state)}`)}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax` };
}

export function validOAuthState(req, expected) {
  const token = parseCookies(req)[OAUTH_STATE_COOKIE];
  if (!token || !expected) return false;
  const [state, signature, extra] = token.split('.');
  return Boolean(state && signature && !extra && safeEqual(state, expected) && safeEqual(signature, hmac(state)));
}

export function clearOAuthStateCookie() {
  return `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  return {};
}

export function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
