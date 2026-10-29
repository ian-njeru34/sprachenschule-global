# Sprachenschule LMS dashboard upgrade — 29 October 2026

## Included
- Student dashboard: published assignments, file/text submissions, submission status, published results and feedback, skill summaries, announcements, and attendance history.
- Tutor dashboard: publish assignments for assigned classes, attach a resource, review submissions, mark work, publish/unpublish results, record attendance, and post class announcements.
- Additive Supabase migration: `supabase/migrations/20261029_learning_management_features.sql`.
- Private Storage buckets for assignment attachments and student submissions (50 MB per file).

## Important deployment order
1. Back up the Supabase database first.
2. In Supabase Dashboard → SQL Editor, run the complete `20261029_learning_management_features.sql` migration.
3. Confirm the SQL completes successfully before deploying the HTML files. Do not run only part of the migration.
4. Deploy the updated `dashboard.html` and `teacher.html` together with the migration file through the existing GitHub/Vercel workflow.
5. Sign in with a test tutor assigned to a test class. Create a test assignment, submit a test student response, mark it, and publish the result. Verify that the student cannot see the result until it is published.
6. Test attendance and announcements with a test class before using real student records.

## Scope and access rules
- Tutors can create and manage assignments and attendance only for their assigned classes (or cohorts assigned to them in the database).
- Students see published assignments only when their active enrolment/access matches the target class, cohort, or course.
- Student submissions are private; results and feedback are hidden until `result_published` is true.
- Students cannot set their own marks or publication flag; database triggers protect those fields.
- Attendance is visible to the student concerned and teaching staff authorised for the class.
- Assignment files are stored in private buckets, not public URLs.
- Registrar/admin can manage records through the database; the current tutor interface is focused on assigned classes.

## Notes
- This is an additive migration and does not remove existing class materials, enrolments, or course cohorts.
- Back up first and test with non-production accounts. This package has been syntax-checked for browser JavaScript, but has not been executed against the live Supabase project. If Supabase reports a migration error, stop and share the exact error before proceeding.
- The interface uses the existing Supabase browser client configuration and should be deployed with the project's current `config.js`.
