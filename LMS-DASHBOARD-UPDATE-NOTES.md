# Sprachenschule LMS dashboard update

## Changes in this update

- Registrar class management is now displayed as a timetable with date, local start/end time, class/cohort, tutor, LIVE/scheduled status, and expandable management controls.
- Removed the manual “Enrol individual students” roster UI. Student access is driven by course/cohort enrolment instead.
- Tutor language and CEFR selection is inside an expandable section.
- Registrar attendance reports retain summary metrics and now expand into cohort totals, per-student sessions, and per-tutor teaching sessions.
- Added `supabase/migrations/20261030_auto_cohort_class_access.sql`. Apply this migration in Supabase SQL Editor after deploying the dashboard update. It syncs approved course/cohort enrolments to existing scheduled classes and backfills existing active enrolments.

## Student access behaviour

The registrar selects the official course and cohort when creating a student account. The course/cohort enrolment remains `pending` while the student's account is pending. When the registrar approves the student's profile (`access_approved = true`), the new database trigger activates the pending course enrolment and inserts the student into every scheduled class for that course/cohort. New scheduled classes are also synced by the existing cohort migration trigger. This removes the need to tick students into individual classes.

## Deployment

1. Back up the database before applying SQL changes.
2. Replace the website files in the GitHub repository with the contents of this ZIP, preserving the repository structure.
3. In Supabase SQL Editor, run `supabase/migrations/20261030_auto_cohort_class_access.sql`.
4. Deploy through Vercel and test with a test student assigned to a course/cohort, approve that student, and confirm that their cohort's scheduled classes appear.
5. Attendance/teaching hours still depend on the trusted server-side LiveKit webhook writing join/leave sessions into `class_attendance` and `tutor_class_sessions`.

## Verification status

Inline JavaScript syntax was checked with Node.js and the ZIP was checked for archive integrity. This package has not been connected to the live Supabase project or deployed/tested against live data in this environment.
