const { supabaseAdmin } = require('../lib/youtube');
const { EgressClient } = require('livekit-server-sdk');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret || String(req.headers.authorization || '') !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  try {
    const admin = supabaseAdmin();
    const { data: recordings, error } = await admin.from('class_recordings')
      .select('id,class_id,egress_id,started_at').eq('status', 'live');
    if (error) throw error;
    if (!recordings?.length) return res.status(200).json({ ok: true, stopped: 0 });
    const base = String(process.env.LIVEKIT_URL || '').replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
    if (!base || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) throw new Error('LiveKit Egress is not configured.');
    const egress = new EgressClient(base, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
    let stopped = 0;
    const errors = [];
    for (const recording of recordings) {
      // The recording clock starts when the tutor first joins and the
      // server receives start-on-live. Rejoins must never reset this timestamp.
      if (!recording.started_at) continue;
      const endAt = new Date(recording.started_at).getTime() + 85 * 60 * 1000;
      if (!Number.isFinite(endAt) || Date.now() < endAt) continue;
      try {
        if (recording.egress_id) await egress.stopEgress(recording.egress_id);
        const { error: updateError } = await admin.from('class_recordings').update({
          status: 'processing', completed_at: new Date().toISOString()
        }).eq('id', recording.id).eq('status', 'live');
        if (updateError) throw updateError;
        stopped++;
      } catch (err) {
        errors.push({ recordingId: recording.id, error: String(err?.message || err).slice(0, 300) });
      }
    }
    return res.status(200).json({ ok: errors.length === 0, stopped, errors });
  } catch (error) {
    console.error('Scheduled class recording stop failed:', error?.message || error);
    return res.status(500).json({ error: 'Could not process scheduled recording end times.' });
  }
};
