# Classroom presentation update

This update enhances `classroom.html` and adds `api/livekit-mute-students.js`.

## Included
- 80/20 desktop classroom stage: presentation occupies 80% and participant tiles use the remaining 20%.
- Audio/video play-pause and playback position controls in the presentation area.
- Video zoom in/out and fit controls.
- PDF.js presentation with vertical page scrolling, page navigation, zoom in/out, and fit-to-width.
- Tutor presentation navigation/playback events are shared with students in the same live class.
- Tutor-only Mute all students / Unmute all students control, enforced by a server-side API route.

## Deployment
1. Replace the project files in the GitHub repository with the contents of this ZIP.
2. Push the changes and wait for Vercel deployment.
3. No database migration or additional environment variables are required. The existing Supabase and LiveKit environment variables are reused.
4. Test in an active scheduled class using a PDF, audio file, and video file.

The server-side mute action uses the existing `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` variables. It only targets participants whose signed LiveKit metadata identifies them as students, and checks the caller's assigned class on the server.
