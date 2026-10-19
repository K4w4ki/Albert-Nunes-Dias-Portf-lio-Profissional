import { ensureOAuthClientConfig } from '../../lib/google-drive.js';
import { isAdmin, isSameOrigin, newOAuthState, sendJson, setSecurityHeaders } from '../../lib/security.js';

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }
  if (!isAdmin(req)) return sendJson(res, 401, { error: 'Entre primeiro na área privada.' });
  try {
    ensureOAuthClientConfig();
    const { state, cookie } = newOAuthState();
    const redirectUri = `${process.env.APP_BASE_URL.replace(/\/$/, '')}/api/google/callback`;
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state
    });
    res.setHeader('Set-Cookie', cookie);
    res.statusCode = 302;
    res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    return res.end();
  } catch (error) {
    return sendJson(res, error.status || 503, { error: error.message || 'Configuração OAuth incompleta.', code: error.code || 'OAUTH_CONFIG_MISSING' });
  }
}
