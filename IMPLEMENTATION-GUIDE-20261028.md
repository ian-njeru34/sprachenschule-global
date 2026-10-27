# Sprachenschule implementation guide (28 October 2026)

## Included in this revision
- Student self-registration is disabled in `school.html`; the existing tutor application path remains available. Students are directed to contact the school for registrar-managed enrolment.
- `dashboard.html` has been reorganised into course/access overview, next lesson, timetable, learning materials and a clearly labelled future progress area. It uses the existing student timetable RPC and published `materials` table.
- `teacher.html` now has assigned-class/resource summary cards and a secure signed-URL preview action for tutor-uploaded files. It continues to leave scheduling to the registrar.
- `admin.html` now includes a registrar-only create/invite student form and loads course options from the catalogue.
- `api/registrar-create-student.js` securely verifies the signed-in registrar on the server, sends an invitation email, creates/updates the student profile and creates a pending course enrolment.
- Added `supabase/migrations/20261028_course_catalogue_and_enrolments.sql`, an additive course catalogue and course-level enrolment foundation.

## Before deploying
1. Keep a copy of your currently deployed ZIP and export a Supabase database backup.
2. In Supabase SQL Editor, review and run `supabase/migrations/20261028_course_catalogue_and_enrolments.sql` only after the earlier migrations in this project have been applied.
3. In Vercel, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as server-side environment variables. Never expose the service-role key in `config.js` or browser code. `SUPABASE_URL` must match the public project URL.
4. Confirm the `profiles`, `registrars`, `scheduled_classes`, and `class_enrolments` table names/columns match your live project. The migration backfills courses from `profiles.level` and `scheduled_classes.level`; it does not delete existing records.
5. Test with one registrar, one approved tutor, and a test student before production.
6. Deploy the revised site to a preview URL first. Confirm login, logout, tutor application, registrar student invitation, course enrolment, class assignment, classroom join, and material preview.

## Important limitations / next phase
- The current registrar UI still creates scheduled classes by a text course/level. The new `courses` table is the foundation, but the registrar class form must next be changed to select a course record and set `scheduled_classes.course_id`.
- The registrar-side invitation API assumes the existing `profiles` table has `id`, `full_name`, `email`, `phone`, `level`, `role`, `access_approved`, and `access_expires_at` columns, and that the existing `registrars` table contains `user_id`. Verify these against the live schema before production.
- Assignments, graded quizzes, attendance analytics, notifications and certificates are not falsely represented as functional; add them after the course/enrolment workflow is connected to the database.
- Student dashboard course access still uses the existing `profiles.level`, access approval and `student_scheduled_classes` RPC until the follow-up migration/UI phase links all access checks to `course_enrolments`.

## Test checklist
- Public visitor can submit a tutor application but cannot self-create a student account.
- Student with pending approval sees no classroom access.
- Approved student sees only their assigned timetable and published course materials.
- Tutor sees only assigned classes and can preview a material via a time-limited signed URL.
- Tutor cannot permanently delete materials; registrar moderation still works.
- Registrar scheduling and roster controls still work.
- LiveKit join and multi-device sign-in remain unchanged.
