# Sprachenschule Global — Vercel + GitHub + Supabase

## Pages
- `index.html` — main public website and course information
- `school.html` — student registration/login
- `dashboard.html` — protected learning area; only approved students with unexpired 4-month access can see level materials
- `shop.html` — learning material shop for video/audio/handouts
- `admin.html` — registrar sign-in and approval dashboard
- `config.js` — Supabase URL and anon key
- `supabase-schema.sql` — database, RLS policies and registrar functions
- `styles.css` — shared design
- `logo.png` — site logo and favicon

## Setup
1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase-schema.sql`.
3. Create a Supabase Auth user for the registrar. Copy its UUID and run the final INSERT shown in the SQL comments.
4. Open `config.js` and replace `YOUR_SUPABASE_PROJECT_URL` and `YOUR_SUPABASE_ANON_KEY` with values from Supabase Project Settings -> API.
5. Push the folder contents to GitHub.
6. Import the GitHub repository into Vercel and deploy.

## Important production note
The supplied front end is a working starter architecture. For private video/audio/handout files, store them in a private Supabase Storage bucket and use a server-side/Edge Function to issue short-lived signed URLs after checking the student's active four-month access. Do not expose private storage files through public URLs.


## Virtual classroom (LiveKit)

The project now includes `classroom.html` and a Vercel serverless endpoint at `api/livekit-token.js`. The classroom is embedded in the school site and supports live audio/video, participant tiles, screen sharing and in-room text chat. It uses the existing Supabase sign-in and checks student approval plus the four-month expiry on the server before issuing a short-lived LiveKit token.

### Required setup before deploying

1. Create a LiveKit Cloud project at https://cloud.livekit.io/ and copy its server URL, API key and API secret.
2. In Vercel -> Project Settings -> Environment Variables, add the values listed in `.env.example`. Use the same Supabase project as `config.js`.
3. Set `SUPABASE_SERVICE_ROLE_KEY` only as a Vercel server-side environment variable. **Never put this secret in `config.js`, HTML, or GitHub.**
4. Add the email address(es) of your teacher accounts to `TEACHER_EMAILS` (comma-separated). Alternatively, if your `profiles` table has a `role`, `account_role`, or `user_role` column, set teacher/admin/registrar roles there.
5. Make sure `config.js` contains your Supabase project URL and public anon/publishable key so the existing website login works.
6. Commit the updated project to GitHub and redeploy on Vercel. Vercel should install the dependencies from `package.json` and deploy `api/livekit-token.js` as a serverless function.
7. Test with a teacher account and an approved student account in two separate browsers/devices.

### Important

- The LiveKit connection will not work until the LiveKit and Vercel environment variables are configured.
- The server endpoint refuses students who are not approved or whose `access_expires_at` has passed. It issues a token valid for two hours.
- The classroom name is currently entered by the user/teacher (for example `german-a1-evening`). Give the exact same name to everyone in that lesson. A later upgrade can add scheduled classes and teacher-managed room creation in the admin dashboard.
- Screen sharing requires a supported browser and permission from the user. Browser camera/microphone permissions are also required.


## New classroom and access controls

- `supabase-schema.sql` is included in this project. Run it in Supabase SQL Editor before testing. It creates the missing profiles/registrar/materials/class schedule/device-session schema and RPC functions.
- `school.html` supports email/password login and registration, plus Show/Hide password controls.
- A single active-device lease is enforced through Supabase RPC heartbeats. The lease expires after two minutes without a heartbeat (for example, if a device loses power). This is an application-level guard, not a guarantee against a technically sophisticated user or shared browser profile.
- `teacher.html` lets authorised teachers schedule a class and join it at lesson time. The student dashboard lists scheduled lessons for the student's approved level.
- `api/livekit-token.js` now only issues LiveKit tokens for a scheduled room, within the lesson window, and checks course level and assigned teacher. Classroom join is available from 15 minutes before start until 15 minutes after the scheduled end.
- LiveKit is used for real-time audio/video. The site does not implement recording. Do not enable recording/egress in LiveKit if you want live attendance only.
- Use private Supabase Storage for protected materials. The current materials table supports a preview URL for starter/testing; do not put paid or private materials at publicly accessible URLs.

## Deployment setup checklist

1. Run `supabase-schema.sql` in Supabase SQL Editor.
2. In Supabase Authentication, check your email confirmation and redirect URL settings for your deployed Vercel domain.
3. In Supabase Authentication -> Users, copy the registrar user's UUID. Run the two SQL statements at the end of `supabase-schema.sql` (replace the placeholder UUID) to grant registrar access.
4. For each teacher, first have them register using `school.html`, then set their role: `update public.profiles set role='teacher' where id='TEACHER-AUTH-UUID';`. Do not make students teachers.
5. Ensure Vercel Environment Variables include `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. Set `TEACHER_EMAILS` only if needed; role-based profiles are preferable.
6. Confirm `config.js` uses the same Supabase project URL and public anon/publishable key. Never put the service-role key or LiveKit API secret in `config.js` or commit them to GitHub.
7. Commit and redeploy. Test registrar approval with a test student, then schedule a lesson as a teacher and join it from separate teacher/student browsers.


## Registrar sign-in fix

- Open `admin.html` directly to see the registrar email/password sign-in form.
- After authentication, the page checks membership in `public.registrars` or a `registrar`/`admin` profile role before showing approvals.
- `school.html` now redirects registrar/admin accounts to `admin.html`, teacher accounts to `teacher.html`, and students to `dashboard.html`.
- Create the initial registrar in Supabase Authentication -> Users, then use its Auth user UUID in the registrar bootstrap SQL described in `supabase-schema.sql`.

## Tutor registration and registrar approval

The account form on `school.html` now lets applicants choose Student or Tutor. Tutor sign-ups are marked with `account_type=tutor` and `approval_status=pending`; the sign-in flow blocks tutor applicants from staff access until their profile role is changed to `tutor` by registrar approval.

Before deploying this workflow, run `supabase/migrations/20261024_tutor_registration_approval.sql` in the Supabase SQL Editor. It creates a private tutor-application queue and registrar-only RPCs used by `admin.html`. The migration assumes `public.profiles` has `id` and `role` columns and that `public.registrars(user_id)` is the registrar allowlist. Verify those schema assumptions against the active project first. The registrar dashboard will then show pending tutor applications alongside student approvals.

## Registrar approvals, class assignment, and classroom materials

A second migration, `supabase/migrations/20261024_classroom_governance_and_materials.sql`, adds registrar-only class assignment RPCs and a private `class-materials` storage bucket. Review the migration against the live Supabase schema before applying it. It expects `profiles` to include `role`, `full_name`, `access_approved`, and `access_expires_at`, and `scheduled_classes` to include `id`, `title`, `level`, `teacher_id`, `starts_at`, `duration_minutes`, `room_name`, and `status`.

- Registrars approve student access using the existing `approve_student` workflow and approve tutor applications using `registrar_approve_tutor`.
- Registrars can assign an approved tutor to a scheduled class from the Registrar Dashboard.
- Tutors can upload notes/PDFs, audio, and video to classes assigned to them. Tutors can hide or re-show their materials, but cannot delete them.
- Registrar material deletion removes the storage object and its database record.
- Student material listings and storage access are restricted by row-level security to approved students in the matching course level during the scheduled live-class window. Materials are presented inside the classroom, and the tutor can present audio/video to participants.

The migration must be applied to Supabase as well as committed to GitHub. Test with separate student, approved tutor, pending tutor, and registrar accounts before production use. Existing RLS policies and schema names can differ; do not apply blindly to production.


### Registrar class creation and individual student enrolment

Run `supabase/migrations/20261024_registrar_class_creation_and_student_enrolment.sql` in the Supabase SQL Editor after the classroom governance migration. It adds registrar-only class creation, per-class student enrolments, class roster management, and a student timetable limited to enrolled classes. The migration also adds the tutor class-insert policy to address tutor scheduling failures caused by row-level security. Students must have active approved access before the registrar can enrol them. Review the migration against your live Supabase schema before applying.


## Tutor assigned classes, registrar scheduling, logout, and device switching

- Tutors now load assigned lessons using the secure `tutor_assigned_classes()` RPC. Class creation/scheduling remains in the Registrar Dashboard only.
- Apply `supabase/migrations/20261024_tutor_assigned_classes_materials.sql` in Supabase SQL Editor if it has not already been applied.
- Apply `supabase/migrations/20261024_force_logout_other_devices.sql` in Supabase SQL Editor to enable the login option that replaces the current user's device-session lease. Review the session table name/columns against the live project first.
- Student, tutor, registrar, and classroom pages provide a Logout action.
