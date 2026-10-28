const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Sign in as registrar first.' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData?.user) return res.status(401).json({ error: 'Your session is invalid or expired.' });

  const actorId = authData.user.id;
  const [{ data: registrar }, { data: profile }] = await Promise.all([
    admin.from('registrars').select('user_id').eq('user_id', actorId).maybeSingle(),
    admin.from('profiles').select('role').eq('id', actorId).maybeSingle()
  ]);
  if (!registrar && !['registrar', 'admin'].includes(profile?.role)) {
    return res.status(403).json({ error: 'Registrar permission is required.' });
  }

  const body = req.body || {};
  const fullName = String(body.full_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const allowedLevels = /^(German|French|English|Spanish|Swahili) (A1|A2|B1|B2|C1|C2)$/;
  const submittedLanguages = Array.isArray(body.languages) ? body.languages : (body.language_level ? [body.language_level] : []);
  const languages = [...new Set(submittedLanguages.map(value => String(value || '').trim()).filter(value => allowedLevels.test(value)))];
  const languageLevel = languages.join(', ');
  if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || languages.length === 0 || languages.length !== submittedLanguages.length) {
    return res.status(400).json({ error: 'Enter a full name, valid email address, and select at least one supported language / CEFR level.' });
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      full_name: fullName,
      phone,
      level: languageLevel,
      language_level: languageLevel,
      role: 'pending_tutor',
      account_type: 'tutor',
      approval_status: 'pending'
    }
  });
  if (inviteError) return res.status(400).json({ error: inviteError.message });

  const tutorId = invited?.user?.id;
  if (!tutorId) return res.status(500).json({ error: 'Invitation was not created. Check Supabase Auth logs.' });

  const { error: profileError } = await admin.from('profiles').upsert({
    id: tutorId,
    full_name: fullName,
    email,
    phone: phone || null,
    level: languageLevel,
    role: 'pending_tutor',
    access_approved: false,
    access_expires_at: null
  }, { onConflict: 'id' });
  if (profileError) {
    return res.status(500).json({ error: 'Tutor invitation sent, but profile setup failed: ' + profileError.message, invited: true });
  }

  // The Auth trigger normally creates this row. Upsert makes the endpoint resilient
  // if the trigger was not installed or did not run for this invitation.
  const { error: applicationError } = await admin.from('tutor_applications').upsert({
    user_id: tutorId,
    full_name: fullName,
    email,
    phone: phone || null,
    language_level: languageLevel,
    status: 'pending'
  }, { onConflict: 'user_id' });
  if (applicationError) {
    return res.status(500).json({ error: 'Tutor invitation sent, but the pending application could not be saved: ' + applicationError.message, invited: true });
  }

  return res.status(201).json({
    ok: true,
    message: 'Tutor invitation sent. The account remains pending until the registrar approves the tutor application.',
    tutor_id: tutorId
  });
};
