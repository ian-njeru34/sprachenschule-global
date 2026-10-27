const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' });

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
  if (!registrar && !['registrar', 'admin'].includes(profile?.role)) return res.status(403).json({ error: 'Registrar permission is required.' });

  const body = req.body || {};
  const fullName = String(body.full_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const courseId = String(body.course_id || '').trim();
  const cohortId = String(body.cohort_id || '').trim();
  if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !courseId || !cohortId) {
    return res.status(400).json({ error: 'Enter a full name, valid email address, course, and cohort.' });
  }

  const [{ data: course, error: courseError }, { data: cohort, error: cohortError }] = await Promise.all([
    admin.from('courses').select('id,title,is_active').eq('id', courseId).maybeSingle(),
    admin.from('course_cohorts').select('id,course_id,name,code,status').eq('id', cohortId).maybeSingle()
  ]);
  if (courseError || !course || !course.is_active) return res.status(400).json({ error: 'Choose an active course from the course catalogue.' });
  if (cohortError || !cohort || cohort.course_id !== course.id || cohort.status !== 'active') return res.status(400).json({ error: 'Choose an active cohort belonging to the selected course.' });

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, phone, level: course.title, role: 'student', account_type: 'student', approval_status: 'pending' }
  });
  if (inviteError) return res.status(400).json({ error: inviteError.message });
  const studentId = invited?.user?.id;
  if (!studentId) return res.status(500).json({ error: 'Invitation was not created. Please check Supabase Auth logs.' });

  // Keep this aligned with the existing profiles model. Access remains pending until the registrar approves it.
  const { error: profileError } = await admin.from('profiles').upsert({
    id: studentId, full_name: fullName, email, phone, level: course.title,
    role: 'student', access_approved: false, access_expires_at: null
  }, { onConflict: 'id' });
  if (profileError) return res.status(500).json({ error: 'Invitation sent, but profile setup failed: ' + profileError.message, invited: true });

  const { error: enrolError } = await admin.from('course_enrolments').upsert({
    student_id: studentId, course_id: course.id, cohort_id: cohort.id, enrolled_by: actorId, status: 'pending'
  }, { onConflict: 'cohort_id,student_id' });
  if (enrolError) return res.status(500).json({ error: 'Student invited, but course enrolment could not be saved: ' + enrolError.message, invited: true });

  return res.status(201).json({ ok: true, message: 'Student invitation sent. Cohort enrolment is pending access approval.', student_id: studentId, course: course.title, cohort: cohort.name, cohort_code: cohort.code });
};
