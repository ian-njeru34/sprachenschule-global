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
