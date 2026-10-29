-- Allow an approved tutor to publish announcements to a cohort
-- when they teach at least one scheduled class in that cohort.
-- Students continue to read published announcements through the existing
-- cohort-enrolment policy in 20261029_learning_management_features.sql.

alter table public.class_announcements
  add column if not exists cohort_id uuid references public.course_cohorts(id) on delete cascade;

create index if not exists class_announcements_cohort_created_idx
  on public.class_announcements(cohort_id, created_at desc);

drop policy if exists lms_announcement_insert on public.class_announcements;
create policy lms_announcement_insert
on public.class_announcements
for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('registrar','admin')
    )
    or (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('tutor','teacher')
      )
      and cohort_id is not null
      and exists (
        select 1 from public.scheduled_classes sc
        where sc.cohort_id = class_announcements.cohort_id
          and sc.teacher_id = auth.uid()
      )
      and class_id is null
      and course_id is null
    )
  )
);

-- Keep edits limited to the creator (or registrar/admin), as in the LMS policy.
