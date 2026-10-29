# Sprachenschule LMS dashboard update

## Included
- Student dashboard: recorded classroom time total, cohort/course hour grouping, and individual join/leave session history.
- Tutor dashboard: read-only live attendance sessions per assigned class and the tutor's recorded teaching-hour report. The old manual attendance upsert has been removed to avoid treating repeated sessions as one attendance row.
- Registrar dashboard: school-wide student-hours by cohort and tutor teaching-hours reports with refresh control.
- Supplemental RLS migration: `supabase/migrations/20261029_lms_attendance_reporting_rls.sql` lets registrar/admin accounts read attendance rows for reporting.

## Important: LiveKit event recording is still required
The successful LMS schema migration creates the tables and columns, but does not itself capture LiveKit room events. The reports will remain empty until a trusted server-side LiveKit webhook/handler writes each student's join/leave session into `public.class_attendance` and each tutor's join/leave session into `public.tutor_class_sessions`. Do not put the Supabase service-role key in browser code. The webhook should authenticate LiveKit events, map the room name to `scheduled_classes.room_name`, map participant identity to the correct Supabase user, de-duplicate event IDs, and close open sessions on participant disconnect.

## Apply
1. Deploy the updated site files.
2. In Supabase SQL Editor, run `supabase/migrations/20261029_lms_attendance_reporting_rls.sql` from this ZIP.
3. Connect the LiveKit webhook separately before expecting automatic session hours.

The three updated dashboard scripts were checked with Node's JavaScript syntax checker. A live browser/database integration test has not been run from this environment.
