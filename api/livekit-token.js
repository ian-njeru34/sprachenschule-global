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
    const isTeacher = allowedTeacherEmails.includes(email) || ['tutor', 'teacher', 'admin', 'registrar'].includes(profileRole);
    if (!isTeacher) {
      if (!profile || profile.access_approved !== true) {
        return res.status(403).json({ error: 'Your school account is not yet approved for live classes. Please contact the registrar.' });
      }
      const expiry = profile.access_expires_at ? new Date(profile.access_expires_at) : null;
      if (!expiry || Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
        return res.status(403).json({ error: 'Your four-month learning access has expired or is not active. Please contact the school.' });
      }
    }

    // Only scheduled rooms can issue tokens. This prevents approved students
    // from guessing or entering unrelated classroom names.
    const { data: scheduledClass, error: classError } = await admin
      .from('scheduled_classes').select('id,title,level,teacher_id,starts_at,duration_minutes,room_name,status')
      .eq('room_name', roomName).maybeSingle();
    if (classError) {
      console.error('Scheduled class lookup failed:', classError.message);
      return res.status(503).json({ error: 'Could not verify the scheduled lesson.' });
    }
    if (!scheduledClass || scheduledClass.status !== 'scheduled') {
      return res.status(403).json({ error: 'This classroom is not linked to a scheduled lesson. Contact your teacher or registrar.' });
    }
    const start = new Date(scheduledClass.starts_at);
    const end = new Date(start.getTime() + Number(scheduledClass.duration_minutes || 60) * 60000);
    const now = new Date();
    if (now < new Date(start.getTime() - 15 * 60000) || now > new Date(end.getTime() + 15 * 60000)) {
      return res.status(403).json({ error: 'This lesson is not open yet or has already ended. Check the timetable.' });
    }
    if (isTeacher) {
      if (!['admin', 'registrar'].includes(profileRole) && scheduledClass.teacher_id !== user.id) {
        return res.status(403).json({ error: 'You are not the teacher assigned to this lesson.' });
      }
    } else {
      const { data: enrolment, error: enrolmentError } = await admin
        .from('class_enrolments').select('id').eq('class_id', scheduledClass.id).eq('student_id', user.id).maybeSingle();
      if (enrolmentError) {
        console.error('Class enrolment lookup failed:', enrolmentError.message);
        return res.status(503).json({ error: 'Could not verify your enrolment for this lesson.' });
      }
      if (!enrolment) return res.status(403).json({ error: 'You are not enrolled in this class. Please contact the registrar.' });
    }

    const identity = user.id;
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: displayName,
      ttl: '2h',
      metadata: JSON.stringify({   role: isTeacher ? 'teacher' : 'student',   classId: scheduledClass.id })
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const jwt = await token.toJwt();
    return res.status(200).json({   url: LIVEKIT_URL,   token: jwt,   role: isTeacher ? 'teacher' : 'student',   classId: scheduledClass.id,   classTitle: scheduledClass.title });
  } catch (err) {
    console.error('Classroom token error:', err && err.message);
    return res.status(500).json({ error: 'Could not prepare a classroom connection. Please try again.' });
  }
};
