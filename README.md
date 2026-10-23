# Sprachenschule Global — Vercel + GitHub + Supabase

## Pages
- `index.html` — main public website and course information
- `school.html` — student registration/login
- `dashboard.html` — protected learning area; only approved students with unexpired 4-month access can see level materials
- `shop.html` — learning material shop for video/audio/handouts
- `admin.html` — registrar approval dashboard
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
