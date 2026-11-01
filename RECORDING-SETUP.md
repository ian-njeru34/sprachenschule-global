# Private class recording setup

This update adds a private `class-recordings` Supabase Storage bucket and registrar recording controls. A registrar arms a recording from the class timetable. When the assigned tutor joins the LiveKit room, the server starts a LiveKit Egress room-composite recording and writes the MP4 into the private bucket. The tutor's normal Leave / Back to dashboard action stops the recording. Registrars can download or permanently delete completed recordings.

## 1. Apply the database migration

In Supabase Dashboard → SQL Editor, run:

`supabase/migrations/20261102_class_recordings_private_bucket.sql`

This creates the private bucket and `public.class_recordings` table. No public bucket access is granted.

## 2. Configure Vercel environment variables

Keep the existing Supabase and LiveKit variables, and add:

- `SUPABASE_S3_ACCESS_KEY_ID`
- `SUPABASE_S3_SECRET_ACCESS_KEY`
- `SUPABASE_S3_REGION` (normally `us-east-1` unless your S3 credentials specify another region)

Generate the S3 access key and secret in Supabase Dashboard → Storage → S3 Connection. Do not use the Supabase service-role key as the S3 secret. The endpoint is derived server-side from `SUPABASE_URL` and uses the `class-recordings` bucket.

LiveKit Cloud / self-hosted LiveKit must have Egress enabled and accessible to the server. The existing `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are used by the server-side Egress client. Never put these secrets in browser JavaScript.

## 3. Deploy and test

After setting the variables, redeploy the Vercel project. Test with a short scheduled class: as registrar, choose **Record class when live**; join as the assigned tutor; confirm a recording row changes from **armed** to **recording**; leave the classroom normally; then as registrar download and play the completed MP4 before deleting it.

Recording requires the Supabase S3 credentials and LiveKit Egress service. If either is not configured, the class can still run, but the recording start will report a configuration error. Recording does not begin until the assigned tutor joins the class.
