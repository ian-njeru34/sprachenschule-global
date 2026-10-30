const { createClient } = require('@supabase/supabase-js');
const { RoomServiceClient } = require('livekit-server-sdk');

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
    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await auth.auth.getUser(accessToken);
    const user = authData && authData.user;
    if (authError || !user) return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });

    const body = req.body || {};
    const roomName = typeof body.roomName === 'string' ? body.roomName.trim() : '';
    const classId = typeof body.classId === 'string' ? body.classId : '';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(roomName) || !classId || typeof body.muted !== 'boolean') {
      return res.status(400).json({ error: 'A valid classroom, class ID and mute state are required.' });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: profile, error: profileError } = await admin
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profileError || !profile) return res.status(403).json({ error: 'Could not verify your school role.' });
    const role = String(profile.role || '').toLowerCase();
    if (!['tutor', 'teacher', 'registrar', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Only the assigned tutor or school administrator can mute students.' });
    }

    const { data: scheduledClass, error: classError } = await admin
      .from('scheduled_classes').select('id,room_name,teacher_id,status')
      .eq('id', classId).eq('room_name', roomName).maybeSingle();
    if (classError || !scheduledClass || scheduledClass.status !== 'scheduled') {
      return res.status(403).json({ error: 'This classroom is not linked to an active scheduled lesson.' });
    }
    if (!['registrar', 'admin'].includes(role) && scheduledClass.teacher_id !== user.id) {
      return res.status(403).json({ error: 'You are not the tutor assigned to this lesson.' });
    }

    const baseUrl = LIVEKIT_URL.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
    const livekit = new RoomServiceClient(baseUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const participants = await livekit.listParticipants(roomName);
    let changed = 0;
    let skipped = 0;
    for (const participant of participants) {
      if (participant.identity === user.id) { skipped++; continue; }
      let participantRole = '';
      try { participantRole = JSON.parse(participant.metadata || '{}').role || ''; } catch {}
      if (participantRole !== 'student') { skipped++; continue; }
      for (const track of (participant.tracks || [])) {
        const type = String(track.type || '').toUpperCase();
        if (!type.includes('AUDIO') || !track.sid) continue;
        await livekit.mutePublishedTrack(roomName, participant.identity, track.sid, body.muted);
        changed++;
      }
    }
    return res.status(200).json({
      ok: true,
      muted: body.muted,
      mutedTracks: body.muted ? changed : 0,
      unmutedTracks: body.muted ? 0 : changed,
      skippedParticipants: skipped
    });
  } catch (error) {
    console.error('Mute-all-students error:', error && error.message);
    return res.status(500).json({ error: 'Could not update student microphones. Please try again.' });
  }
};
