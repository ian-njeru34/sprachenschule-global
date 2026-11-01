const { createClient } = require('@supabase/supabase-js');
const { EgressClient, EncodedFileOutput, S3Upload } = require('livekit-server-sdk');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const bearer = req.headers.authorization || '';
  const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
    SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY, SUPABASE_S3_REGION = 'us-east-1' } = process.env;
  if (!token) return res.status(401).json({ error: 'Please sign in.' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return res.status(503).json({ error: 'Supabase server configuration is incomplete.' });
  try {
    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user) return res.status(401).json({ error: 'Your sign-in has expired.' });
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const user = authData.user;
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = String(profile?.role || '').toLowerCase();
    const registrar = ['registrar', 'admin'].includes(role) || !!(await admin.from('registrars').select('user_id').eq('user_id', user.id).maybeSingle()).data;
    const body = req.body || {};
    const action = String(body.action || '');
    const classId = String(body.classId || '');
    if (!classId) return res.status(400).json({ error: 'A class ID is required.' });
    const { data: cls, error: classError } = await admin.from('scheduled_classes').select('id,room_name,teacher_id,title').eq('id', classId).maybeSingle();
    if (classError || !cls) return res.status(404).json({ error: 'Scheduled class not found.' });
    if (action === 'arm' || action === 'download' || action === 'delete') {
      if (!registrar) return res.status(403).json({ error: 'Registrar access required.' });
    } else if (!registrar && !(['tutor','teacher'].includes(role) && cls.teacher_id === user.id)) {
      return res.status(403).json({ error: 'Only the assigned tutor or registrar can control this recording.' });
    }

    if (action === 'arm') {
      const { data: active } = await admin.from('class_recordings').select('id,status').eq('class_id', classId).in('status', ['armed','recording']).maybeSingle();
      if (active) return res.status(409).json({ error: 'A recording is already armed or running for this class.' });
      const { data, error } = await admin.from('class_recordings').insert({ class_id: classId, requested_by: user.id, status: 'armed' }).select('id,status').single();
      if (error) throw error;
      return res.status(200).json({ ok: true, recording: data });
    }

    if (action === 'start-on-live') {
      if (!['tutor','teacher'].includes(role) || cls.teacher_id !== user.id) return res.status(403).json({ error: 'Only the assigned tutor can start the armed recording.' });
      const { data: armed, error } = await admin.from('class_recordings').select('*').eq('class_id', classId).eq('status','armed').order('created_at',{ascending:false}).limit(1).maybeSingle();
      if (error) throw error;
      if (!armed) return res.status(200).json({ ok: true, message: 'No recording is armed for this class.' });
      if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !SUPABASE_S3_ACCESS_KEY_ID || !SUPABASE_S3_SECRET_ACCESS_KEY) {
        return res.status(503).json({ error: 'Recording is armed, but LiveKit Egress and Supabase S3 credentials are not configured.' });
      }
      const endpoint = `${SUPABASE_URL.replace(/\/$/,'')}/storage/v1/s3`;
      const roomHost = LIVEKIT_URL.replace(/^wss:/i,'https:').replace(/^ws:/i,'http:');
      const egress = new EgressClient(roomHost, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
      const storagePath = `${classId}/${new Date().toISOString().replace(/[:.]/g,'-')}-${armed.id}.mp4`;
      const output = new EncodedFileOutput({
        filepath: storagePath,
        output: new S3Upload({ accessKey: SUPABASE_S3_ACCESS_KEY_ID, secret: SUPABASE_S3_SECRET_ACCESS_KEY,
          bucket: 'class-recordings', region: SUPABASE_S3_REGION, endpoint, forcePathStyle: true })
      });
      const started = await egress.startRoomCompositeEgress(cls.room_name, output, { layout: 'speaker' });
      const egressId = started.egressId || started.egress_id;
      const { error: updateError } = await admin.from('class_recordings').update({ status:'recording', egress_id:egressId, storage_path:storagePath, started_at:new Date().toISOString() }).eq('id',armed.id);
      if (updateError) throw updateError;
      return res.status(200).json({ ok:true, recordingId:armed.id, egressId });
    }

    if (action === 'stop') {
      if (!['tutor','teacher'].includes(role) || cls.teacher_id !== user.id) return res.status(403).json({ error: 'Only the assigned tutor can stop the class recording.' });
      const { data: active } = await admin.from('class_recordings').select('*').eq('class_id',classId).eq('status','recording').order('created_at',{ascending:false}).limit(1).maybeSingle();
      if (!active) return res.status(200).json({ ok:true, message:'No active recording.' });
      const base = LIVEKIT_URL.replace(/^wss:/i,'https:').replace(/^ws:/i,'http:');
      const egress = new EgressClient(base,LIVEKIT_API_KEY,LIVEKIT_API_SECRET);
      await egress.stopEgress(active.egress_id);
      await admin.from('class_recordings').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',active.id);
      return res.status(200).json({ok:true});
    }

    if (action === 'download' || action === 'delete') {
      const recordingId = String(body.recordingId || '');
      const { data: recording, error } = await admin.from('class_recordings').select('*').eq('id',recordingId).eq('class_id',classId).maybeSingle();
      if (error || !recording || !recording.storage_path || recording.status !== 'completed') return res.status(404).json({ error: 'Completed recording not found.' });
      if (action === 'download') {
        const { data: signed, error: signError } = await admin.storage.from('class-recordings').createSignedUrl(recording.storage_path, 300, { download: true });
        if (signError) throw signError;
        return res.status(200).json({ ok:true, url:signed.signedUrl });
      }
      const { error: removeError } = await admin.storage.from('class-recordings').remove([recording.storage_path]);
      if (removeError) throw removeError;
      const { error: deleteError } = await admin.from('class_recordings').delete().eq('id',recording.id);
      if (deleteError) throw deleteError;
      return res.status(200).json({ok:true});
    }
    return res.status(400).json({ error: 'Unknown recording action.' });
  } catch (error) {
    console.error('Class recording operation failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Recording operation failed.' });
  }
};
