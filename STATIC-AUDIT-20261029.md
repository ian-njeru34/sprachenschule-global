# Static audit notes — 29 October 2026

## Fixes applied in this archive
- `set-password.html`: post-password success link now points to the real login page, `school.html` (there is no `login.html` in this project).
- `dashboard.html` and `teacher.html`: logout no longer depends on the retired `release_student_session` RPC. This prevents a stale session ID or missing RPC from interrupting sign-out. Multi-device sign-in remains enabled; Supabase local sign-out signs out only this browser session.

## Verification performed
- JavaScript files and inline scripts passed Node.js syntax checks.
- Reviewed role routing, registrar/student/tutor endpoints, classroom token authorization flow, classroom material presentation flow, and migration sequence.
- This is a static source audit, not a live integration test. It does not prove that Vercel environment variables, Supabase schema/RLS policies, email templates, LiveKit credentials, or real account credentials are correct.

## Items to verify in the live deployment
1. In Supabase Auth URL Configuration, keep the Site URL correct and allow `https://www.sprachenschule.co.ke/set-password.html`. The student invite endpoint now redirects there.
2. Confirm the Supabase invitation email template uses the normal confirmation URL flow so Supabase can establish the session on the password page. If the page reports an invalid invitation, inspect the link format with all tokens redacted.
3. `set-password.html` currently does not enforce the requested 48-hour deadline. This needs a server-verified invitation expiry design before it can be considered implemented.
4. The archive contains migrations dated 30 and 31 October 2026, later than the current date of 29 October 2026. Do not run them blindly or assume they are applied. Review and apply migrations in dependency order, after confirming earlier migrations succeeded.
5. Live tests required: student pending/approved/expired; pending/approved tutor; registrar/admin authorization; cohort-specific enrolment; scheduled class time windows; LiveKit camera/mic/screen share; material visibility/presentation; and sign-out on one device while another remains signed in.

## Important expected behavior
- Pending students must not gain classroom access.
- Pending tutors must not gain tutor tools or classroom presenter privileges.
- Registrar-created student enrolments start pending and must not automatically approve learning access.
- Tutors should only manage materials for assigned classes; permanent deletion remains a registrar function.
