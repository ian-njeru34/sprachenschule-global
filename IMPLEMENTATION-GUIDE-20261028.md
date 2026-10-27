# Sprachenschule implementation guide (28 October 2026)

## Included in this revision
- Student self-registration is disabled in `school.html`; the existing tutor application path remains available. Students are directed to contact the school for registrar-managed enrolment.
- `dashboard.html` has been reorganised into course/access overview, next lesson, timetable, learning materials and a clearly labelled future progress area. It uses the existing student timetable RPC and published `materials` table.
- `teacher.html` now has assigned-class/resource summary cards and a secure signed-URL preview action for tutor-uploaded files. It continues to leave scheduling to the registrar.
- `admin.html` now includes a registrar-only create/invite student form and loads course options from the catalogue.
- `api/registrar-create-student.js` securely verifies the signed-in registrar on the server, sends an invitation email, creates/updates the student profile and creates a pending course enrolment.
- Added `supabase/migrations/20261028_course_catalogue_and_enrolments.sql`, an additive course catalogue and course-level enrolment foundation.
- Added `supabase/migrations/20261029_course_cohorts.sql` to distinguish a course from its separate cohorts. Existing course classes and enrolments are backfilled into a per-course `General Cohort` to preserve records.
- Registrar dashboard now supports creating cohorts, assigning new or existing students to a specific cohort, and scheduling each class against a cohort. Student and tutor dashboards display the assigned cohort. Class access synchronisation matches both course and cohort. The cohort code is entered manually by the registrar (for example `OCT_GA1`); the form uppercases it and accepts 2–30 letters, numbers, underscores or hyphens. Codes and names must be unique within their course.

## Before deploying
1. Keep a copy of your currently deployed ZIP and export a Supabase database backup.
2. In Supabase SQL Editor, review and run `supabase/migrations/20261028_course_catalogue_and_enrolments.sql` only after the earlier migrations in this project have been applied.
3. Then review and run `supabase/migrations/20261029_course_cohorts.sql`. This is required for the new cohort controls. Do not run the cohort UI against the database before this migration succeeds.
4. In Vercel, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as server-side environment variables. Never expose the service-role key in `config.js` or browser code. `SUPABASE_URL` must match the public project URL.
5. Confirm the `profiles`, `registrars`, `scheduled_classes`, and `class_enrolments` table names/columns match your live project. The migration backfills courses from `profiles.level` and `scheduled_classes.level`; it does not delete existing records.
6. Test with one registrar, one approved tutor, and at least two test students before production. Create two cohorts under the same course using codes such as `OCT_GA1` and `NOV_GA1`, enrol each student into a different cohort, and schedule separate classes for both groups. Confirm lowercase input is automatically converted to uppercase and duplicate codes are rejected for the same course.
7. Deploy the revised site to a preview URL first. Confirm login, logout, tutor application, registrar student invitation, course enrolment, class assignment, classroom join, and material preview.

## Important limitations / next phase
- Classes must now be created against a specific cohort. The older class-edit form keeps the course/level fixed to avoid accidentally moving a class between cohorts; use the new cohort-aware class creation workflow for new cohort sessions.
- The registrar-side invitation API assumes the existing `profiles` table has `id`, `full_name`, `email`, `phone`, `level`, `role`, `access_approved`, and `access_expires_at` columns, and that the existing `registrars` table contains `user_id`. Verify these against the live schema before production.
- Assignments, graded quizzes, attendance analytics, notifications and certificates are not falsely represented as functional; add them after the course/enrolment workflow is connected to the database.
- Legacy `General Cohort` records are retained during backfill. Review the cohort list and rename/create proper cohorts before enrolling new students into each group. The student dashboard shows the active/pending course cohort, while the timetable still uses the existing `student_scheduled_classes` RPC and cohort-specific class enrolments.

## Test checklist
- Public visitor can submit a tutor application but cannot self-create a student account.
- Student with pending approval sees no classroom access.
- Two students in different cohorts of the same course see only their own cohort’s classes.
- Registrar can transfer an existing approved student to another cohort; future classes follow the new cohort and past class records are preserved.
- Approved student sees only their assigned timetable and published course materials.
- Tutor sees only assigned classes and can preview a material via a time-limited signed URL.
- Tutor cannot permanently delete materials; registrar moderation still works.
- Registrar scheduling and roster controls still work.
- Verify a class roster only offers students actively enrolled in that cohort.
- LiveKit join and multi-device sign-in remain unchanged.
