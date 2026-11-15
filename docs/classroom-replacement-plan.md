# Sprachenschule browser classroom replacement

## Scope and deployment safety

This work is isolated on `classroom-webrtc-replacement`. Do not change `main`, production Vercel configuration, production Supabase schema/policies, or production environment variables until the replacement has passed the acceptance checks below. Do not remove existing school data, enrolments, scheduled classes, attendance, or stored class materials.

The replacement must not introduce a paid service, subscription, external meeting site, separate account, or required installation. The classroom is served from the existing Sprachenschule website and uses the existing school login.

## Navigation and page behaviour

- A student joins from the existing student dashboard's next-lesson card or scheduled-lesson list.
- A tutor joins from the existing tutor dashboard's assigned/scheduled lesson.
- The join action opens the live classroom page at the same Sprachenschule origin, in the same browser tab (no `target="_blank"`, no external redirect, no new tab).
- The classroom page is an internal school page. It must preserve the authenticated Supabase session and provide a clear return-to-dashboard action.
- A scheduled lesson link may pass only its room identifier as a URL parameter. The server must independently validate the signed-in user, class, role, assignment/enrolment, class status, and permitted join window. Never trust a role, class ID, participant count, or permission supplied only by the browser.
- Keep authentication redirects limited to unauthenticated/unauthorised cases. Normal join/leave navigation must remain within `sprachenschule.co.ke`.

## Classroom architecture

- Replace LiveKit media transport with direct browser WebRTC peer connections (mesh) for small classes.
- Maximum room size: **7 people total** — one assigned tutor and up to six enrolled students. Enforce this on the server with an atomic room-admission operation, not only in the UI.
- Supabase Realtime is for authenticated signalling and ephemeral classroom events only; it does not carry audio/video. Audio/video and screen-share media travel directly between browsers.
- Do not add a hosted SFU or paid TURN relay. Document that restrictive NAT/firewall networks may prevent direct peer connectivity without TURN; do not promise universal connectivity. Test on different mobile and fixed networks.
- Reuse the school's existing Supabase Auth, profiles, scheduled_classes, class_enrolments, class_presence, class_attendance, and private class-materials storage where appropriate. Inspect actual schema and RLS before any production migration.
- Avoid frequent polling. Use Realtime presence/broadcast for ephemeral room state and conservative heartbeat/cleanup behaviour.

## Permissions to preserve

- Only approved, non-suspended students with valid access and an enrolment in the exact scheduled class may join.
- Only the assigned tutor may join as tutor and operate tutor controls. Registrar/admin exceptions must follow existing school policy.
- Preserve the scheduled lesson time window (currently 15 minutes before start through 15 minutes after scheduled end) unless the school explicitly changes it.
- Student microphone publishing is disabled until the assigned tutor is present. Tutor can mute all students. Enforce permissions server-side and revalidate when tutor presence changes.
- Only the assigned tutor (and authorised school staff where existing policy permits) may present materials, control presentation, share screen, clear raised hands, and use tutor controls.

## User experience and existing features

Preserve and retest:
- Tutor/student audio and video, participant tiles, connection state, microphone/camera controls, and red leave control.
- Screen sharing, with the shared content occupying about 80% of the stage and participant tiles in a side column.
- Classroom chat, clap/reactions, raised hands, tutor clear-hands control, attendance and tutor mute-all.
- Tutor presentation of existing private class materials; student view synchronised with tutor.
- Existing PDF.js presentation and zoom controls (initial zoom 25%), sharp/high-resolution rendering, no clipped left/right edges, fit-to-stage layout, and an internal scroll bar rather than stretching the page.
- Audio/video lesson materials and synchronised playback controls where currently supported.
- Responsive desktop, tablet, and phone layouts.

## LiveKit-dependent functionality

Identify every LiveKit import, API route, webhook, environment variable, and egress/recording dependency before removal. YouTube Live/Egress is a separate feature; it must not be represented as supported by the P2P classroom unless separately redesigned and tested. Keep old LiveKit implementation available on the production branch until the replacement is accepted.

## Implementation sequence

1. Inventory the complete classroom page, dashboard entry points, all LiveKit API routes, RLS policies, database tables/functions, and material presentation code.
2. Implement and test server-authorised room admission, room capacity (7 total), private Realtime signalling/event access, and cleanup before enabling media.
3. Implement WebRTC offer/answer/ICE exchange, reconnect handling, participant state, and the tutor-present microphone gate.
4. Port classroom controls and existing materials/presentation features without changing their access rules.
5. Update student and tutor dashboard lesson actions to open the internal classroom page in the same tab; ensure no external/new-tab link is introduced.
6. Test two through seven real devices, tutor plus six students, simultaneous joins at capacity, a rejected eighth participant, reconnects, browser permissions, mobile browsers, screen share, PDF rendering, materials, chat, reactions, attendance, mute-all, tutor departure, and restrictive networks.
7. Review security, RLS, API authorisation, race conditions, and data usage. Deploy only after acceptance and with a rollback plan.
8. Remove LiveKit secrets/dependencies/routes only after every remaining consumer (including YouTube Egress/recording) has been migrated or deliberately retired.

## Acceptance criteria

- The production classroom and existing school data remain unchanged until approval.
- A student/tutor can join from their existing dashboard through an internal same-tab link.
- No new tab, external conferencing site, separate login, installation, or paid service is required.
- Exactly one tutor plus up to six students can be admitted; an eighth person is rejected even under simultaneous join attempts.
- Existing class, enrolment, role, approval, expiry, tutor assignment, and scheduled-time rules remain enforced on the server.
- All retained classroom features listed above pass multi-device tests.
- The limitations of direct P2P without TURN are clearly disclosed and tested.
