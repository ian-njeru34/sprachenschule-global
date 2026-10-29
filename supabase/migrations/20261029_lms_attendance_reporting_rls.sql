-- Allow registrar/admin accounts to read attendance sessions for school-wide reports.
-- This is additive: student and tutor access continues to follow the existing policies.

drop policy if exists lms_attendance_registrar_read on public.class_attendance;
create policy lms_attendance_registrar_read
on public.class_attendance
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('registrar', 'admin')
  )
);

grant select on public.class_attendance to authenticated;
