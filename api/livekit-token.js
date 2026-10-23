const { createClient } = require('@supabase/supabase-js');
const { AccessToken } = require('livekit-server-sdk');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!accessToken) return res.status(401).json({ error: 'Please sign in to your school account.' });

  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
    LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY ||
      !LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return res.status(503).json({ error: 'The virtual classroom is not fully configured. Please contact the school administrator.' });
  }

  try {
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    const user = authData && authData.user;
    if (authError || !user) return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });

    const body = req.body || {};
    const roomName = typeof body.roomName === 'string' ? body.roomName.trim() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : '';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(roomName)) {
      return res.status(400).json({ error: 'Use a valid classroom name with letters, numbers, hyphens or underscores.' });
    }
    if (!displayName) return res.status(400).json({ error: 'Enter your display name.' });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: profile, error: profileError } = await admin
      .from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (profileError) {
      console.error('Classroom profile lookup failed:', profileError.message);
      return res.status(503).json({ error: 'Could not verify your school access. Please try again later.' });
    }

    const allowedTeacherEmails = (process.env.TEACHER_EMAILS || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const email = (user.email || '').toLowerCase();
    const profileRole = String(profile && (profile.role || profile.account_role || profile.user_role) || '').toLowerCase();
    const isTeacher = allowedTeacherEmails.includes(email) || ['teacher', 'admin', 'registrar'].includes(profileRole);
    if (!isTeacher) {
      if (!profile || profile.access_approved !== true) {
        return res.status(403).json({ error: 'Your school account is not yet approved for live classes. Please contact the registrar.' });
      }
      const expiry = profile.access_expires_at ? new Date(profile.access_expires_at) : null;
      if (!expiry || Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
        return res.status(403).json({ error: 'Your four-month learning access has expired or is not active. Please contact the school.' });
      }
    }

    const identity = user.id;
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: displayName,
      ttl: '2h',
      metadata: JSON.stringify({ role: isTeacher ? 'teacher' : 'student' })
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: isTeacher ? ['camera', 'microphone', 'screen_share', 'screen_share_audio'] : ['camera', 'microphone', 'screen_share']
    });
    const jwt = await token.toJwt();
    return res.status(200).json({ url: LIVEKIT_URL, token: jwt, role: isTeacher ? 'teacher' : 'student' });
  } catch (err) {
    console.error('Classroom token error:', err && err.message);
    return res.status(500).json({ error: 'Could not prepare a classroom connection. Please try again.' });
  }
};
