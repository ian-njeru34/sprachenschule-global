# Sprachenschule: private YouTube Live class recording

This version keeps the existing Sprachenschule website classroom and LiveKit room as the teaching environment. When a registrar arms a class, the server creates a **Private** YouTube Live broadcast in advance so the registrar can invite viewers before the lesson. When the assigned tutor joins the room, LiveKit Egress sends the separate RTMP stream to that already-created broadcast. When the tutor leaves, the server stops Egress; YouTube's `enableAutoStop` setting is asked to end the broadcast and YouTube retains its archive.

**No class video is written to Supabase Storage.** Supabase remains in use for authentication, profiles, class scheduling, cohorts, materials and recording metadata. The class-recordings table stores YouTube IDs and status only.

## Important viewer-access limitation

A YouTube broadcast/video set to **Private** is not viewable by anyone with only the link. The registrar must add each intended viewer's Google account in YouTube Studio for the upcoming private broadcast. The YouTube Data API does not expose a supported method for this application to invite those individual accounts automatically. The registrar should do this after arming the broadcast and before the tutor starts the lesson, then verify the archived video remains Private after the stream ends. A private stream can therefore be created automatically, but per-student private invitations remain a manual YouTube Studio step.

## 1. Apply the Supabase migration

In Supabase Dashboard → SQL Editor → New query, run:

`supabase/migrations/20261102_youtube_live_recordings.sql`

This creates the registrar-readable `class_recordings` metadata table, the server-only `youtube_connections` table, and the server-only `youtube_live_targets` table. The last table holds encrypted ingest URLs/stream keys and has no client policies. It does not create a Storage bucket. The migration also removes the old `storage_path` column if the earlier recording migration was previously applied. Do not run the older `20261102_class_recordings_private_bucket.sql` migration for this version.

## 2. Configure Google / YouTube API

1. Open Google Cloud Console and create/select a project.
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen and add the school Google account as a test user while the app is in Testing mode (or complete Google's verification/publishing requirements for wider use).
4. Create an OAuth Client ID of type **Web application**.
5. Add this exact authorised redirect URI (must match the Vercel production hostname):

   `https://www.sprachenschule.co.ke/api/youtube-oauth-callback`

6. Copy the OAuth client ID and client secret. The registrar then clicks **Connect school YouTube channel** in the registrar dashboard and authorises the channel that should host the lessons.
7. The channel must be enabled and eligible for YouTube Live streaming. YouTube may require initial live-stream activation and an account waiting period before the first broadcast.

The Google account used for OAuth should own or manage the school's YouTube channel and have permission to create live broadcasts.

## 3. Configure Vercel environment variables

Keep the existing values used by the site:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Add:

- `GOOGLE_CLIENT_ID` — OAuth Web Client ID from Google Cloud.
- `GOOGLE_CLIENT_SECRET` — OAuth Web Client secret.
- `YOUTUBE_REDIRECT_URI` — exactly `https://www.sprachenschule.co.ke/api/youtube-oauth-callback`.
- `YOUTUBE_OAUTH_STATE_SECRET` — a long random secret used to sign the short-lived OAuth state. Use at least 32 random bytes.
- `YOUTUBE_TOKEN_ENCRYPTION_KEY` — a 32-byte key, supplied as either 64 hexadecimal characters or base64 encoding of exactly 32 bytes. It encrypts the YouTube refresh token before it is stored in Supabase.
- `APP_BASE_URL` — `https://www.sprachenschule.co.ke` (use the canonical production host that serves `admin.html`).

Generate the two random secrets using a trusted password manager or secure secret generator. Do not put any of these values in `config.js`, HTML, GitHub, or browser JavaScript. If the OAuth client or encryption key is rotated, reconnect the channel; if the encryption key is lost, the stored refresh token cannot be decrypted and YouTube must be connected again.

No Supabase S3 access key, S3 secret, S3 region, or `class-recordings` Storage bucket is required for video recording in this version.

## 4. Confirm LiveKit Egress

- LiveKit Cloud projects include Egress availability; self-hosted LiveKit deployments must deploy and configure Egress separately.
- The LiveKit API key must have the `roomRecord` permission.
- The Egress service must be able to reach YouTube's RTMP/RTMPS ingest endpoint.
- Egress streams the room-composite output to YouTube. It does not save an MP4 in Supabase.

The current implementation uses a 480p / 30 fps YouTube ingest profile. Actual bitrate and YouTube processing are controlled by LiveKit Egress and YouTube ingest, not by Supabase Storage.

## 5. Deploy and connect

1. Upload the contents of this project folder to the GitHub repository connected to the existing Vercel project.
2. Commit and push; wait for Vercel to deploy.
3. Add the environment variables above in Vercel → Project → Settings → Environment Variables.
4. Redeploy after adding the variables.
5. Sign in to the registrar dashboard.
6. Click **Connect school YouTube channel** and approve the requested YouTube access using the correct school channel account.
7. Confirm the dashboard reports the channel as connected.

## 6. Test before a real class

1. Schedule a short test class and assign an approved tutor.
2. In the timetable, choose **Private YouTube stream when live**. The server creates a private upcoming broadcast and displays its YouTube watch link.
3. Before class, open YouTube Studio → Content → Live, select the upcoming private broadcast, and use the visibility/share controls to invite the students' Google accounts. Confirm that each email is the exact Google account the student will use.
4. Join the existing website classroom as the assigned tutor. The website classroom remains the teaching space; YouTube is a separate output.
5. Confirm the registrar's recording list changes from `armed` to `live` and the YouTube watch link is available.
6. Confirm the invited test Google account can watch the private live stream; an uninvited account should not be able to watch.
7. Leave the classroom using the normal tutor leave/back action. The Egress stream should stop and the recording status should become `processing`.
8. In the registrar dashboard, click **Check archive** after a few minutes. It becomes `completed` only after the API sees a completed broadcast, processed video, and Private privacy status.
9. Open the archived video in YouTube Studio and confirm it remains Private and that the invited Google accounts are still listed.

## Operational safeguards and limitations

- A YouTube stream failure should not be treated as a reason to disconnect the website classroom. The class remains in LiveKit; the registrar should check the dashboard and Vercel function logs if YouTube streaming fails.
- The website's tutor leave action sends the stop request. If a tutor loses connectivity abruptly, the registrar may need to stop/finish the broadcast in YouTube Studio; do not assume every network failure triggers a clean stop callback.
- YouTube archive processing is asynchronous. `processing` does not mean the recording is ready. Verify in YouTube Studio before sharing the video.
- Private access is account-based, not link-based. An invited viewer must sign in to the exact Google account invited by the registrar.
- YouTube's live archive feature has limits (including a 12-hour maximum for automatic archiving). Do not rely on YouTube Live as the sole archive for lessons longer than 12 hours.
- Google OAuth consent-screen testing mode can limit which accounts may authorise the integration. Complete Google's publishing/verification requirements if required for the intended school users.
- This integration is prepared for deployment but cannot be live-tested without the school's Google OAuth credentials, YouTube channel authorisation, and LiveKit Egress configuration.
