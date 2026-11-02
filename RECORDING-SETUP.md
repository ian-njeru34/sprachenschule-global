# Class recording destination

The current implementation streams armed class sessions from LiveKit Egress directly to a **Private YouTube Live** broadcast. YouTube retains the archive after the tutor ends the lesson. No video file is stored in Supabase Storage.

Follow `YOUTUBE-LIVE-SETUP.md` for the required Supabase metadata migration, Google OAuth setup, Vercel environment variables, LiveKit Egress requirements, and testing procedure. Do not apply the retired `20261102_class_recordings_private_bucket.sql` migration or configure Supabase S3 credentials for this version.
