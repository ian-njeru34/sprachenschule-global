module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', 'https://sprachenschule.co.ke');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = req.body || {};
    const event = typeof body.event === 'string' ? body.event.slice(0, 80) : 'unknown';
    const detail = typeof body.detail === 'string' ? body.detail.slice(0, 700) : '';
    const room = typeof body.room === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.room)
      ? body.room : '';
    const record = {
      source: 'recording-layout',
      event,
      detail,
      room,
      at: new Date().toISOString()
    };
    console.log('[RECORDING_DIAGNOSTIC]', JSON.stringify(record));
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[RECORDING_DIAGNOSTIC] failed', error && error.message);
    return res.status(400).json({ error: 'Invalid diagnostic report.' });
  }
};