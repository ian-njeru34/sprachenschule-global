const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function env(name) { const value = process.env[name]; if (!value) throw new Error(`Missing server configuration: ${name}`); return value; }
function keyBytes() {
  const raw = env('YOUTUBE_TOKEN_ENCRYPTION_KEY');
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) throw new Error('YOUTUBE_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64).');
  return decoded;
}
function encrypt(text) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}
function decrypt(value) {
  const [iv, tag, data] = String(value || '').split('.');
  if (!iv || !tag || !data) throw new Error('Stored YouTube connection token is invalid. Reconnect YouTube.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
function stateSign(payload) { return crypto.createHmac('sha256', env('YOUTUBE_OAUTH_STATE_SECRET')).update(payload).digest('base64url'); }
function createState(userId) { const payload = Buffer.from(JSON.stringify({ uid: userId, iat: Date.now() })).toString('base64url'); return `${payload}.${stateSign(payload)}`; }
function verifyState(state) {
  const [payload, signature] = String(state || '').split('.'); if (!payload || !signature) throw new Error('Invalid YouTube authorisation state.');
  const expected = Buffer.from(stateSign(payload)); const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error('YouTube authorisation state could not be verified.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!data.uid || !data.iat || Date.now() - data.iat > 10 * 60 * 1000 || data.iat > Date.now() + 60000) throw new Error('YouTube authorisation link has expired. Start the connection again.');
  return data;
}
function oauthRedirectUri() { return env('YOUTUBE_REDIRECT_URI'); }
async function tokenRequest(body) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error_description || data.error || 'Google token request failed.'); return data;
}
function supabaseAdmin() { return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } }); }
async function getYouTubeAccessToken(admin) {
  const { data, error } = await admin.from('youtube_connections').select('encrypted_refresh_token').eq('id', 'primary').maybeSingle();
  if (error) throw error; if (!data?.encrypted_refresh_token) throw new Error('Connect the school YouTube channel from the registrar dashboard first.');
  const refreshToken = decrypt(data.encrypted_refresh_token);
  const tokens = await tokenRequest({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (!tokens.access_token) throw new Error('Google did not return an access token. Reconnect YouTube.');
  return tokens.access_token;
}
async function youtubeRequest(accessToken, path, options = {}) {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const message = data?.error?.message || `YouTube API request failed (${response.status}).`; throw new Error(message); }
  return data;
}
module.exports = { env, encrypt, decrypt, createState, verifyState, oauthRedirectUri, tokenRequest, supabaseAdmin, getYouTubeAccessToken, youtubeRequest };
