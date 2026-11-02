const { createClient } = require('@supabase/supabase-js');
const { env, createState, oauthRedirectUri } = require('../lib/youtube');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Please sign in.' });
    const auth = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
    const { data: { user }, error } = await auth.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Your sign-in has expired.' });
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const { data: registrar } = await admin.from('registrars').select('user_id').eq('user_id', user.id).maybeSingle();
    if (!['registrar','admin'].includes(String(profile?.role || '').toLowerCase()) && !registrar) return res.status(403).json({ error: 'Registrar access required.' });
    const params = new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: oauthRedirectUri(), response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', scope: 'https://www.googleapis.com/auth/youtube', state: createState(user.id) });
    return res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (error) { return res.status(500).json({ error: error.message || 'Could not start YouTube connection.' }); }
};
