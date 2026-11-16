# Sprachenschule-owned classroom: recording and streaming architecture

## Current release state

The legacy LiveKit classroom and its LiveKit-dependent Vercel routes have been removed from the active application. The former implementations are retained under `archive/livekit-serverless/`. The active `classroom.html` is a temporary maintenance page while the replacement is built.

## Classroom requirements

- Existing Sprachenschule authentication and same-tab dashboard entry.
- One assigned tutor and at most six students (seven participants total).
- Tutor presence is authoritative and time-limited; students join in listen-only mode until the assigned tutor is present.
- Tutor departure, loss of heartbeat, suspension, or class end immediately returns student audio to listen-only.
- Preserve camera, microphone, screen share, participant tiles, chat, reactions, raised hands, attendance, mute-all, class materials and PDF presentation.
- Keep the classroom on the school domain and use existing scheduled class and enrolment records.
- No LiveKit dependency and no paid meeting provider.

## WebRTC and signalling

Use browser WebRTC for direct media and Supabase Realtime private channels for signalling, presence, chat and control events. Signal messages contain only the SDP/ICE data needed to establish peer connections; never put media bytes into Realtime or Postgres.

Use authenticated private channels and RLS policies scoped to the scheduled class. Membership must be derived from the authenticated user, approved/non-suspended profile, unexpired student access, exact class enrolment, or assigned tutor relationship. Do not trust role, class ID, tutor status, or permissions supplied by the browser.

A server-controlled heartbeat records the assigned tutor's presence. A server endpoint validates the user's access and scheduled class window before creating/updating presence. Clients must fail closed: if tutor presence cannot be verified, student microphones stay disabled and remote student audio is not played. A client-side UI toggle is not a security boundary; direct P2P has no media server that can forcibly revoke a malicious participant's outgoing track. If strict server-enforced media-level muting is mandatory against modified clients, an SFU/media relay is required.

## Participant limit

Enforce the seven-person limit atomically in a database-backed join/lease operation. A browser-only count or Realtime Presence count is insufficient because two users could join simultaneously. Expire leases on disconnect/heartbeat timeout and reject the eighth active participant.

## Class recording

The P2P test branch now includes a first browser-based recording implementation: the assigned tutor can record a 720p canvas composition of the presentation stage and participant strip, mix available remote audio and the tutor microphone through Web Audio, and save one WebM file to the existing private `class-materials` bucket. Recording metadata is stored in `class_recordings`; only the assigned tutor can start a recording, and authorized enrolled students can access completed recordings. The UI shows a recording indicator and stops at a 45 MB safety threshold to stay below the bucket's 50 MB file limit.

This is an initial single-file implementation, not segmented/resumable recording. It uses browser memory and depends on the tutor's device, tab and network remaining active until upload completes. It is not a cloud recording guarantee. If the tab closes, the device sleeps, or the network fails during upload, the recording may be lost. Test short sessions first.

## YouTube Live

The existing YouTube OAuth connection and encrypted refresh-token design can be reused, but the old LiveKit Egress implementation cannot. YouTube Live ingest requires a continuous RTMP/RTMPS publisher. Vercel serverless functions are short-lived request handlers and are not a suitable always-on media relay.

The no-paid-provider design is:
1. Tutor browser composes the same classroom output (canvas video + mixed audio).
2. A self-hosted streaming bridge receives the composed stream over a supported transport and publishes RTMPS to YouTube.
3. The server stores YouTube stream credentials encrypted and never exposes the stream key to student browsers.
4. Registrar arms a private broadcast; only the assigned tutor can start/stop it; the API records lifecycle, errors and watch URL.
5. Stream health and reconnect status are visible in the tutor/registrar UI.

A self-hosted bridge needs an always-on host (for example, a school-owned computer). A tablet or phone browser cannot act as a dependable always-on RTMP server. A small VPS is an alternative but introduces hosting cost. YouTube Live is deliberately not enabled in the current P2P test branch: no RTMP bridge has been provisioned, and the browser-only classroom does not itself publish an RTMPS stream. Do not claim YouTube Live is operational until the bridge is provisioned and end-to-end tested.

## Network limitations

Direct peer-to-peer WebRTC without TURN can fail on restrictive NATs, mobile networks and corporate firewalls. This should be surfaced as a connection diagnostic, not hidden. A TURN relay improves reachability but requires an always-on host and consumes bandwidth. No free, unlimited, universally reliable TURN service is assumed.

## Security and acceptance tests

- Student joins before tutor: can hear permitted class audio/video but cannot publish microphone; receiver clients reject student audio until tutor presence is valid.
- Tutor joins: enrolled students can request microphone access; server validates the assigned tutor and presence lease.
- Tutor disconnects or heartbeat expires: all clients fail closed and student audio is blocked.
- Unassigned tutor, unapproved/suspended/expired student, unenrolled student, invalid class window and guessed room are rejected.
- Concurrent joins at the limit never allow more than seven participants.
- Realtime channel access is private and membership-scoped; no broad authenticated-user policies.
- Screen share, PDF/material presentation, chat, reactions, hands, attendance and mute-all work across desktop, tablet and mobile browsers.
- Recording uploads survive temporary network interruption and are private to authorized school users.
- YouTube test broadcast receives actual audio/video, starts only when tutor is present, reconnects safely, stops cleanly and leaves a private processed archive.
- Test on separate devices and separate networks, including mobile data and restrictive Wi-Fi.

## Rollout

Do not restore the classroom route to the live lesson dashboards until the replacement passes the acceptance tests. Keep the legacy code archive intact until the replacement is stable and the school confirms it can be retired permanently.
