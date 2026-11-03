const { createClient } = require('@supabase/supabase-js');
const { RoomServiceClient } = require('livekit-server-sdk');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const bearer = req.headers.authorization || '';
  const accessToken = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  if (!accessToken) return res.status(401).json({ error: 'Please sign in.' });

  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
    LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY ||
      !LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return res.status(503).json({ error: 'Classroom services are not fully configured.' });
  }

  try {
    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await auth.auth.getUser(accessToken);
    const user = authData && authData.user;
    if (authError || !user) return res.status(401).json({ error: 'Your sign-in has expired.' });

    const body = req.body || {};
    const roomName = typeof body.roomName === 'string' ? body.roomName.trim() : '';
    const classId = typeof body.classId === 'string' ? body.classId : '';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(roomName) || !classId || typeof body.joined !== 'boolean') {
      return res.status(400).json({ error: 'A valid classroom, class ID and presence state are required.' });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const [{ data: profile, error: profileError }, { data: scheduledClass, error: classError }] = await Promise.all([
      admin.from('profiles').select('role,access_approved,access_suspended,access_expires_at')
        .eq('id', user.id).maybeSingle(),
      admin.from('scheduled_classes').select('id,room_name,teacher_id,status')
        .eq('id', classId).eq('room_name', roomName).maybeSingle()
    ]);
    if (profileError || !profile) return res.status(403).json({ error: 'Could not verify your school role.' });
    if (classError || !scheduledClass || scheduledClass.status !== 'scheduled') {
      return res.status(403).json({ error: 'This is not an active scheduled classroom.' });
    }

    const role = String(profile.role || '').toLowerCase();
    const isAssignedTutor = ['tutor', 'teacher'].includes(role) && scheduledClass.teacher_id === user.id;
    const isSchoolAdmin = ['admin', 'registrar'].includes(role);
    const isStudent = role === 'student';
    if (!isAssignedTutor && !isSchoolAdmin && !isStudent) {
      return res.status(403).json({ error: 'Your account cannot update classroom presence.' });
    }
    if (isStudent) {
      if (profile.access_approved !== true || profile.access_suspended === true ||
          !profile.access_expires_at || new Date(profile.access_expires_at) <= new Date()) {
        return res.status(403).json({ error: 'Your student access is not active.' });
      }
      const { data: enrolment, error: enrolmentError } = await admin.from('class_enrolments')
        .select('id').eq('class_id', classId).eq('student_id', user.id).maybeSingle();
      if (enrolmentError || !enrolment) return res.status(403).json({ error: 'You are not enrolled in this class.' });
    }
    if (isAssignedTutor && profile.access_suspended === true) {
      return res.status(403).json({ error: 'Your tutor access is suspended.' });
    }
    if (isSchoolAdmin && !body.joined) {
      // Administrators do not own the tutor-presence record.
    }

    if (body.joined) {
      const { error } = await admin.from('class_presence').upsert({
        class_id: classId, user_id: user.id, last_seen_at: new Date().toISOString()
      }, { onConflict: 'class_id,user_id' });
      if (error) throw error;
    } else {
      const { error } = await admin.from('class_presence').delete()
        .eq('class_id', classId).eq('user_id', user.id);
      if (error) throw error;
    }

    const { data: tutorPresence, error: tutorPresenceError } = await admin.from('class_presence')
      .select('last_seen_at').eq('class_id', classId).eq('user_id', scheduledClass.teacher_id)
      .gte('last_seen_at', new Date(Date.now() - 45000).toISOString()).maybeSingle();
    if (tutorPresenceError) throw tutorPresenceError;
    const tutorPresent = Boolean(tutorPresence);

    const baseUrl = LIVEKIT_URL.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
    const livekit = new RoomServiceClient(baseUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const participants = await livekit.listParticipants(roomName);
    let updated = 0;
    let mutedTracks = 0;
    for (const participant of participants) {
      let metadata = {};
      try { metadata = JSON.parse(participant.metadata || '{}'); } catch {}
      if (String(metadata.classId) !== String(classId)) continue;
      if (metadata.role !== 'student') continue;

      const permission = {
        canPublish: tutorPresent,
        canSubscribe: true,
        canPublishData: true
      };
      await livekit.updateParticipant(roomName, participant.identity, undefined, permission);
      updated++;

      if (!tutorPresent) {
        for (const track of (participant.tracks || [])) {
          if (String(track.type || '').toUpperCase().includes('AUDIO') && track.sid) {
            await livekit.mutePublishedTrack(roomName, participant.identity, track.sid, true);
            mutedTracks++;
          }
        }
      }
    }

    return res.status(200).json({ ok: true, tutorPresent, updatedStudentPermissions: updated, mutedTracks });
  } catch (error) {
    console.error('Classroom presence/permission error:', error && error.message);
    return res.status(500).json({ error: 'Could not synchronize classroom microphone permissions.' });
  }
};
