const { env, encrypt, verifyState, oauthRedirectUri, tokenRequest, supabaseAdmin, youtubeRequest } = require('../lib/youtube');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const base = (process.env.APP_BASE_URL || 'https://www.sprachenschule.co.ke').replace(/\/$/, '');
  const fail = (message) => res.redirect(302, `${base}/admin.html?youtube=error&message=${encodeURIComponent(message).slice(0, 300)}`);
  if (req.method !== 'GET') return res.status(405).send('Method not allowed.');
  try {
    if (req.query.error) return fail('Google authorisation was cancelled or denied.');
    const state = verifyState(req.query.state);
    if (!req.query.code) return fail('Google did not return an authorisation code.');
    const tokens = await tokenRequest({ code: String(req.query.code), client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: oauthRedirectUri(), grant_type: 'authorization_code' });
    let refreshToken = tokens.refresh_token;
    const admin = supabaseAdmin();
    if (!refreshToken) {
      const { data: existing } = await admin.from('youtube_connections').select('encrypted_refresh_token').eq('id', 'primary').maybeSingle();
      if (existing?.encrypted_refresh_token) refreshToken = require('../lib/youtube').decrypt(existing.encrypted_refresh_token);
    }
    if (!refreshToken) throw new Error('Google did not provide a refresh token. Reconnect and approve offline access.');
    const accessToken = tokens.access_token;
    let channelTitle = 'Connected YouTube channel'; let channelId = null;
    try { const channel = await youtubeRequest(accessToken, 'channels?part=snippet&mine=true'); const item = channel.items?.[0]; if (item) { channelTitle = item.snippet?.title || channelTitle; channelId = item.id || null; } } catch (_) {}
    const { error } = await admin.from('youtube_connections').upsert({ id: 'primary', connected_by: state.uid, encrypted_refresh_token: encrypt(refreshToken), channel_title: channelTitle, channel_id: channelId, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
    return res.redirect(302, `${base}/admin.html?youtube=connected`);
  } catch (error) { console.error('YouTube OAuth callback failed:', error.message); return fail(error.message || 'YouTube connection failed.'); }
};
