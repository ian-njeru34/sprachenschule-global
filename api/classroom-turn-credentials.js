const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGINS = new Set([
  'https://sprachenschule.co.ke',
  'https://www.sprachenschule.co.ke'
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Vary', 'Origin');

  const origin = req.headers.origin;
  const isVercelPreview = process.env.VERCEL_ENV === 'preview' &&\n    /^https:\/\/sprachenschule-global-[a-z0-9-]+-ian-mwandiki-njeru\\.vercel\\.app$/.test(origin || '');\n  if (origin && (ALLOWED_ORIGINS.has(origin) || isVercelPreview)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  } else if (origin) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    CLOUDFLARE_TURN_KEY_ID,
    CLOUDFLARE_TURN_API_TOKEN
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY ||
      !CLOUDFLARE_TURN_KEY_ID || !CLOUDFLARE_TURN_API_TOKEN) {
    return res.status(503).json({ error: 'TURN service is not configured.' });
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in to the school first.' });

  const classId = String(req.body?.class_id || '');
  if (!UUID_RE.test(classId)) return res.status(400).json({ error: 'A valid scheduled class is required.' });

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) return res.status(401).json({ error: 'Your school session is invalid or expired.' });

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, role, access_approved, access_expires_at, access_suspended')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (profileError || !profile) return res.status(403).json({ error: 'Your school profile could not be verified.' });

    const role = String(profile.role || '').toLowerCase();
    if (!['student', 'tutor', 'teacher', 'registrar', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Your account cannot use classroom media.' });
    }
    if (profile.access_suspended || (role === 'student' && !profile.access_approved)) {
      return res.status(403).json({ error: 'Your classroom access is not active.' });
    }
    if (profile.access_expires_at && new Date(profile.access_expires_at) <= new Date()) {
      return res.status(403).json({ error: 'Your school access has expired.' });
    }

    // Re-check class membership/assignment with the caller's own Supabase JWT.
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer ' + token } }
    });
    const { data: scheduled, error: classError } = await caller.rpc('classroom_get_scheduled_class', {
      p_class_id: classId,
      p_title: null,
      p_room_name: null
    });
    if (classError || !Array.isArray(scheduled) || scheduled.length !== 1 || scheduled[0].id !== classId) {
      return res.status(403).json({ error: 'You are not authorised for this scheduled classroom.' });
    }

    // Six-hour temporary credentials cover the longest normal lesson window.
    const response = await fetch(
      'https://rtc.live.cloudflare.com/v1/turn/keys/' +
        encodeURIComponent(CLOUDFLARE_TURN_KEY_ID) +
        '/credentials/generate-ice-servers',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + CLOUDFLARE_TURN_API_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ttl: 21600
        })
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error('[TURN] Cloudflare credential request failed:', response.status, detail.slice(0, 500));
      return res.status(502).json({ error: 'Secure relay credentials are temporarily unavailable.' });
    }

    const result = await response.json();
    if (!Array.isArray(result.iceServers) || !result.iceServers.length) {
      console.error('[TURN] Cloudflare returned no ICE servers.');
      return res.status(502).json({ error: 'Secure relay configuration was incomplete.' });
    }

    return res.status(200).json({
      iceServers: result.iceServers,
      expiresInSeconds: 21600
    });
  } catch (error) {
    console.error('[TURN] Credential endpoint failed:', error?.message || error);
    return res.status(500).json({ error: 'Could not prepare classroom network connectivity.' });
  }
};
