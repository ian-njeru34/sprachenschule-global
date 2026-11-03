const { createClient } = require('@supabase/supabase-js');
const { env, encrypt, decrypt, supabaseAdmin, getYouTubeAccessToken, youtubeRequest } = require('../lib/youtube');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const bearer = req.headers.authorization || '';
  const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please sign in.' });
  try {
    const auth = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user) return res.status(401).json({ error: 'Your sign-in has expired.' });
    const admin = supabaseAdmin();
    const user = authData.user;
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = String(profile?.role || '').toLowerCase();
    const { data: registrarRow } = await admin.from('registrars').select('user_id').eq('user_id', user.id).maybeSingle();
    const registrar = ['registrar', 'admin'].includes(role) || !!registrarRow;
    const body = req.body || {};
    const action = String(body.action || '');

    if (action === 'connection-status') {
      if (!registrar) return res.status(403).json({ error: 'Registrar access required.' });
      const { data, error } = await admin.from('youtube_connections').select('channel_title,channel_id,connected_at').eq('id','primary').maybeSingle();
      if (error) throw error;
      return res.status(200).json({ ok:true, connected:!!data, channelTitle:data?.channel_title || null, connectedAt:data?.connected_at || null });
    }

    const classId = String(body.classId || '');
    if (!classId) return res.status(400).json({ error: 'A class ID is required.' });
    const { data: cls, error: classError } = await admin.from('scheduled_classes').select('id,room_name,teacher_id,title,starts_at,duration_minutes').eq('id', classId).maybeSingle();
    if (classError || !cls) return res.status(404).json({ error: 'Scheduled class not found.' });
    if (['arm','refresh'].includes(action)) {
      if (!registrar) return res.status(403).json({ error: 'Registrar access required.' });
    } else if (!registrar && !(['tutor','teacher'].includes(role) && cls.teacher_id === user.id)) {
      return res.status(403).json({ error: 'Only the assigned tutor or registrar can control this recording.' });
    }

    if (action === 'arm') {
      const { data: active } = await admin.from('class_recordings').select('id,status').eq('class_id', classId).in('status', ['armed','starting','live','processing']).maybeSingle();
      if (active) return res.status(409).json({ error: 'A YouTube stream is already armed or running for this class.' });
      const accessToken = await getYouTubeAccessToken(admin);
      const title = `${String(cls.title || 'Sprachenschule lesson').slice(0, 85)} | Sprachenschule`;
      const stream = await youtubeRequest(accessToken, 'liveStreams?part=snippet,cdn,contentDetails', { method:'POST', body:JSON.stringify({ snippet:{ title }, cdn:{ ingestionType:'rtmp', resolution:'480p', frameRate:'30fps' }, contentDetails:{ isReusable:false } }) });
      const scheduledStart = new Date(cls.starts_at || Date.now());
      const startTime = scheduledStart.getTime() > Date.now() + 120000 ? scheduledStart : new Date(Date.now()+120000);
      const broadcast = await youtubeRequest(accessToken, 'liveBroadcasts?part=snippet,status,contentDetails', { method:'POST', body:JSON.stringify({ snippet:{ title, description:'Private Sprachenschule class session. Access is limited to Google accounts explicitly invited by the school.', scheduledStartTime:startTime.toISOString() }, status:{ privacyStatus:'private' }, contentDetails:{ enableAutoStart:true, enableAutoStop:true, recordFromStart:true, enableDvr:true, enableEmbed:false } }) });
      try {
        await youtubeRequest(accessToken, `liveBroadcasts/bind?id=${encodeURIComponent(broadcast.id)}&part=id,contentDetails&streamId=${encodeURIComponent(stream.id)}`, { method:'POST', body:'{}' });
        const ingest = stream.cdn?.ingestionInfo?.rtmpsIngestionAddress || stream.cdn?.ingestionInfo?.ingestionAddress;
        const streamKey = stream.cdn?.ingestionInfo?.streamName;
        if (!ingest || !streamKey) throw new Error('YouTube did not return a usable RTMP ingest address and stream key.');
        const watchUrl = `https://www.youtube.com/watch?v=${broadcast.id}`;
        const { data: recording, error: insertError } = await admin.from('class_recordings').insert({ class_id:classId, requested_by:user.id, status:'armed', youtube_broadcast_id:broadcast.id, youtube_stream_id:stream.id, youtube_video_id:broadcast.id, youtube_watch_url:watchUrl }).select('id,status,youtube_watch_url').single();
        if (insertError) throw insertError;
        const { error: secretError } = await admin.from('youtube_live_targets').insert({ recording_id:recording.id, encrypted_ingest_url:encrypt(`${ingest.replace(/\/$/,'')}/${streamKey}`) });
        if (secretError) {
          await admin.from('class_recordings').update({status:'failed',error_message:'Could not securely save YouTube ingest credentials.'}).eq('id',recording.id);
          throw secretError;
        }
        return res.status(200).json({ ok:true, recording, watchUrl, message:'Private YouTube broadcast created. Invite the intended Google accounts in YouTube Studio before the lesson starts.' });
      } catch (error) {
        try { await youtubeRequest(accessToken, `liveBroadcasts?id=${encodeURIComponent(broadcast.id)}`, {method:'DELETE'}); } catch (_) {}
        try { await youtubeRequest(accessToken, `liveStreams?id=${encodeURIComponent(stream.id)}`, {method:'DELETE'}); } catch (_) {}
        throw error;
      }
    }

    if (action === 'start-on-live') {
      if (!['tutor','teacher'].includes(role) || cls.teacher_id !== user.id) return res.status(403).json({ error: 'Only the assigned tutor can start the armed YouTube stream.' });
      const { data: armed, error } = await admin.from('class_recordings').select('*').eq('class_id', classId).eq('status','armed').order('created_at',{ascending:false}).limit(1).maybeSingle();
      if (error) throw error;
      if (!armed) return res.status(200).json({ ok: true, message: 'No YouTube stream is armed for this class.' });
      if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) return res.status(503).json({ error: 'LiveKit Egress is not configured. The classroom can continue without YouTube streaming.' });
      const { data: target, error: targetError } = await admin.from('youtube_live_targets').select('encrypted_ingest_url').eq('recording_id',armed.id).maybeSingle();
      if (targetError || !target?.encrypted_ingest_url) throw new Error('The secure YouTube stream target is missing. Ask the registrar to arm the stream again.');
      await admin.from('class_recordings').update({ status:'starting' }).eq('id',armed.id);
      try {
        const { EgressClient, StreamOutput, StreamProtocol } = require('livekit-server-sdk');
        const egressUrl = decrypt(target.encrypted_ingest_url);
        const base = process.env.LIVEKIT_URL.replace(/^wss:/i,'https:').replace(/^ws:/i,'http:');
        const egress = new EgressClient(base, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
        const output = new StreamOutput({ protocol:StreamProtocol.RTMP, urls:[egressUrl] });
        // Use the school's custom recorder view so the broadcast includes a live
        // attendance strip, the tutor's shared screen, and participant cameras.
        // Materials shown in the tutor's browser are included when the tutor shares
        // the classroom browser tab; DOM-only content is not a LiveKit room track.
        // Prefer an explicitly configured public app URL, then Vercel's production
        // domain. VERCEL_PROJECT_PRODUCTION_URL is provided without a scheme.
        const configuredAppUrl = process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'www.sprachenschule.co.ke';
        const appOrigin = /^https?:\\/\\//i.test(configuredAppUrl) ? configuredAppUrl : 'https://' + configuredAppUrl;
        const recordingTemplateUrl = new URL('/recording-layout.html', appOrigin).toString();
        const started = await egress.startRoomCompositeEgress(
          cls.room_name,
          output,
          'classroom',
          undefined,
          false,
          false,
          recordingTemplateUrl
        );
        const egressId = started.egressId || started.egress_id;
        const { error:updateError } = await admin.from('class_recordings').update({ status:'live', egress_id:egressId, started_at:new Date().toISOString() }).eq('id',armed.id);
        if (updateError) { try { await egress.stopEgress(egressId); } catch (_) {} throw updateError; }
        return res.status(200).json({ ok:true, recordingId:armed.id, egressId, watchUrl:armed.youtube_watch_url });
      } catch (error) {
        await admin.from('class_recordings').update({ status:'failed', error_message:String(error.message || 'Could not start YouTube stream').slice(0,1000) }).eq('id',armed.id);
        throw error;
      }
    }

    if (action === 'stop') {
      if (!['tutor','teacher'].includes(role) || cls.teacher_id !== user.id) return res.status(403).json({ error: 'Only the assigned tutor can stop the YouTube stream.' });
      const { data: active } = await admin.from('class_recordings').select('*').eq('class_id',classId).eq('status','live').order('created_at',{ascending:false}).limit(1).maybeSingle();
      if (!active) return res.status(200).json({ ok:true, message:'No active YouTube stream.' });
      const base = process.env.LIVEKIT_URL.replace(/^wss:/i,'https:').replace(/^ws:/i,'http:');
      const egress = new EgressClient(base,process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET);
      await egress.stopEgress(active.egress_id);
      await admin.from('class_recordings').update({status:'processing',completed_at:new Date().toISOString()}).eq('id',active.id);
      return res.status(200).json({ok:true,message:'YouTube stream stopped. YouTube is processing the private archive.'});
    }

    if (action === 'refresh') {
      const recordingId = String(body.recordingId || '');
      const { data: recording, error } = await admin.from('class_recordings').select('*').eq('id',recordingId).eq('class_id',classId).maybeSingle();
      if (error || !recording || !recording.youtube_broadcast_id) return res.status(404).json({error:'YouTube recording was not found.'});
      const accessToken = await getYouTubeAccessToken(admin);
      const broadcast = await youtubeRequest(accessToken, `liveBroadcasts?part=status&id=${encodeURIComponent(recording.youtube_broadcast_id)}`);
      const life = broadcast.items?.[0]?.status?.lifeCycleStatus;
      const video = await youtubeRequest(accessToken, `videos?part=status,processingDetails&id=${encodeURIComponent(recording.youtube_video_id)}`);
      const videoStatus = video.items?.[0]?.status;
      const processing = video.items?.[0]?.processingDetails?.processingStatus;
      let status = recording.status;
      if (life === 'complete' && videoStatus?.uploadStatus === 'processed' && videoStatus?.privacyStatus === 'private' && processing !== 'failed') status = 'completed';
      else if (life === 'complete' || recording.status === 'processing') status = 'processing';
      const { error:updateError } = await admin.from('class_recordings').update({status}).eq('id',recording.id);
      if (updateError) throw updateError;
      return res.status(200).json({ok:true,status,lifeCycleStatus:life || 'unknown',processingStatus:processing || videoStatus?.uploadStatus || 'pending',privacyStatus:videoStatus?.privacyStatus || 'not available',watchUrl:recording.youtube_watch_url});
    }

    return res.status(400).json({ error: 'Unknown recording action.' });
  } catch (error) {
    console.error('YouTube class-stream operation failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'YouTube streaming operation failed.' });
  }
};
