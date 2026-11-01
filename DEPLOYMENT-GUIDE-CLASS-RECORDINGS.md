# Sprachenschule — consolidated classroom recording update

This archive is based on the newer classroom-recording project archive. It includes the existing site and classroom files, registrar recording controls, the server-side LiveKit Egress endpoint, and the private `class-recordings` Supabase bucket migration.

## Important scope note

This package adds the class-recording workflow. It does **not** yet include a YouTube OAuth connection or a working registrar YouTube-upload button. YouTube private-video uploads can be automated, but YouTube's supported Data API does not provide a way to add named Google accounts to a video's private-viewer list. After upload, the registrar must add those Google accounts manually in YouTube Studio. Keep the Supabase recording until YouTube processing and access have been checked.

The current Egress output is MP4. This project code does not explicitly set the proposed 480p / 15 fps / 650 kbps compression profile; do not assume that exact compressed size or quality until Egress encoding settings are configured and tested.

## Before deployment

1. Download this ZIP and extract it.
2. Open the extracted `sprachenschule-global-main` folder and confirm it contains `api/class-recordings.js`, `RECORDING-SETUP.md`, and `supabase/migrations/20261102_class_recordings_private_bucket.sql`.
3. Commit and push the contents of that folder to the GitHub repository connected to the existing Vercel project. Do not create a second Vercel project unless you intentionally want a separate site.
4. In Supabase Dashboard → SQL Editor, check whether the migration `20261102_class_recordings_private_bucket.sql` has already been applied. If it has not, run it once. Do not rerun it blindly; inspect the resulting bucket/table first.
5. In Supabase Dashboard → Storage → S3 Connection, create/copy the S3 access key and secret for the project. Do not use the Supabase service-role key as the S3 secret.
6. In Vercel → Project → Settings → Environment Variables, retain the existing environment variables and add:
   - `SUPABASE_S3_ACCESS_KEY_ID`
   - `SUPABASE_S3_SECRET_ACCESS_KEY`
   - `SUPABASE_S3_REGION` (use the region shown by Supabase S3 Connection; do not guess)
7. Confirm the existing server-side variables are present and correct:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `LIVEKIT_URL`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
8. Confirm LiveKit Egress is enabled for the LiveKit deployment and can reach the Supabase S3 endpoint. Egress is a separate LiveKit capability/service; adding Vercel variables alone does not enable it.
9. Redeploy the existing Vercel project after adding the variables.

## First test (do not start with a real lesson)

1. Create or use a short test class with an assigned tutor.
2. Sign in as registrar and choose **Record class when live** for that class.
3. Join that class as its assigned tutor.
4. Confirm the recording status changes from `armed` to `recording`.
5. Leave the classroom normally so the tutor-side stop action runs.
6. Sign in as registrar, wait for Egress to finish writing the file, then download and play the MP4.
7. Only after the MP4 plays correctly should you test deletion. Do not delete the Supabase copy just because a recording row says completed.

## Storage and privacy

The `class-recordings` bucket is private. The registrar download action creates a short-lived signed download URL. Do not make the bucket public and do not expose the service-role key or S3 secret in browser code.

## Rollback

If the classroom or recording workflow has a problem, redeploy the previous known-good Git commit in Vercel. Do not delete the `class-recordings` bucket or table while recordings are stored there. Preserve a database backup before making schema changes.
