# Website UX and redundancy audit

## Changes made
- Replaced the public “Student area” navigation group with direct **Login** and **Library** links. Added a thin utility strip above the main header.
- Login page now asks users to choose **Student** or **Tutor / staff** before signing in. Student registration collects full name, email, phone, password, and a required language/course level. Staff accounts are not self-registerable; the registrar must authorise them.
- Replaced user-facing teacher wording with **tutor** where found, while retaining the existing `teacher_id` database field for backward compatibility.
- Removed public navigation links to the virtual classroom and e-learning page. The classroom page now redirects unauthenticated users and students without active approved access; the e-learning resource page redirects accounts without approved, unexpired access.
- Renamed public materials-shop language to **Library** where applicable.

## Redundancy and content recommendations
1. **Learning method vs homepage:** both explain registration, payment, approval and access duration. Keep the homepage version short and make `learning-method.html` the single detailed explanation.
2. **About page vs homepage:** both contain overview cards and calls to explore courses. Keep the homepage focused on conversion and reserve institutional background for About.
3. **Courses vs Admissions:** avoid repeating detailed course lists in admissions; link to Courses and keep Admissions focused on fees, schedules and enquiry.
4. **Shop vs e-learning materials:** clarify the distinction: Library is for purchasing study materials; the authenticated dashboard is for materials already assigned to enrolled students. Avoid selling the same items in two places unless the catalogue and fulfilment process are deliberately shared.
5. **Login vs registration:** keep one canonical account entry point (`school.html`) with sign-in and student registration. Staff accounts should be provisioned/approved by a registrar, not created through public registration.
6. **Private pages:** hiding links is not security. Supabase row-level security and server-side policies must enforce roles, course approval, and purchases; client-side redirects only improve navigation. Protect `classroom.html`, `e-learning.html`, and any material URLs at the backend/storage layer too.

## Deployment checks still required
- Confirm the Supabase `profiles` role values used for tutors (legacy `teacher` is accepted in the UI for compatibility).
- Confirm the existing database trigger creates a student profile and stores course level from signup metadata. The frontend cannot safely create privileged staff roles.
- Multi-device sign-in is enabled in the frontend; no device-session lease RPC is required.
- Confirm Library products have a working payment/fulfilment workflow; this visual/navigation pass does not create payment processing.
- Run an authenticated/unauthenticated smoke test after deployment and verify RLS policies on profiles, scheduled classes, materials and storage.
