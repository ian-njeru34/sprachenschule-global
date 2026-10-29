-- Sprachenschule LMS: assignments, submissions, published results, attendance, announcements.
-- Apply after the existing course/cohort and class-enrolment migrations.

create table if not exists public.assignments (
 id uuid primary key default gen_random_uuid(),
 title text not null check (length(trim(title)) between 1 and 180),
 instructions text not null default '',
 class_id uuid references public.scheduled_classes(id) on delete cascade,
 cohort_id uuid references public.course_cohorts(id) on delete cascade,
 course_id uuid references public.courses(id) on delete set null,
 created_by uuid not null references auth.users(id) on delete restrict,
 due_at timestamptz,
 max_points numeric(7,2) not null default 100 check (max_points > 0),
 skill text not null default 'general' check (skill in ('general','listening','reading','writing','speaking','grammar','vocabulary','hoeren','lesen','schreiben','sprechen')),
 attachment_path text,
 status text not null default 'draft' check (status in ('draft','published','archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (class_id is not null or cohort_id is not null or course_id is not null)
);
create index if not exists assignments_class_due_idx on public.assignments(class_id,due_at);
create index if not exists assignments_cohort_due_idx on public.assignments(cohort_id,due_at);

create table if not exists public.assignment_submissions (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public.assignments(id) on delete cascade,
 student_id uuid not null references auth.users(id) on delete cascade,
 answer_text text not null default '',
 file_path text,
 submitted_at timestamptz not null default now(),
 status text not null default 'submitted' check (status in ('submitted','late','marked','returned','resubmit')),
 score numeric(7,2), feedback text not null default '',
 marked_by uuid references auth.users(id) on delete set null,
 marked_at timestamptz,
 result_published boolean not null default false,
 updated_at timestamptz not null default now(),
 unique(assignment_id,student_id)
);
create index if not exists assignment_submissions_student_idx on public.assignment_submissions(student_id,submitted_at desc);

create table if not exists public.class_attendance (
 id uuid primary key default gen_random_uuid(),
 class_id uuid not null references public.scheduled_classes(id) on delete cascade,
 student_id uuid not null references auth.users(id) on delete cascade,
 attendance_status text not null check (attendance_status in ('present','late','absent','excused')),
 notes text not null default '',
 recorded_by uuid not null references auth.users(id) on delete restrict,
 recorded_at timestamptz not null default now(),
 unique(class_id,student_id)
);
create index if not exists class_attendance_student_idx on public.class_attendance(student_id,recorded_at desc);

create table if not exists public.class_announcements (
 id uuid primary key default gen_random_uuid(),
 title text not null check (length(trim(title)) between 1 and 180),
 body text not null default '',
 class_id uuid references public.scheduled_classes(id) on delete cascade,
 cohort_id uuid references public.course_cohorts(id) on delete cascade,
 course_id uuid references public.courses(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete restrict,
 published boolean not null default true,
 created_at timestamptz not null default now(),
 check (class_id is not null or cohort_id is not null or course_id is not null)
);
create index if not exists class_announcements_created_idx on public.class_announcements(created_at desc);

create or replace function public.lms_is_staff()
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('tutor','teacher','registrar','admin'));
$$;
create or replace function public.lms_can_teach_assignment(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(
  select 1 from public.assignments a
  left join public.scheduled_classes sc on sc.id=a.class_id
  left join public.course_cohorts cc on cc.id=coalesce(a.cohort_id,sc.cohort_id)
  join public.profiles p on p.id=auth.uid() and p.role in ('tutor','teacher','registrar','admin')
  where a.id=p_assignment_id and (
   p.role in ('registrar','admin') or a.created_by=auth.uid() or sc.teacher_id=auth.uid() or cc.default_tutor_id=auth.uid()
  )
 );
$$;
create or replace function public.lms_student_can_access_assignment(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(
  select 1 from public.assignments a
  left join public.scheduled_classes sc on sc.id=a.class_id
  where a.id=p_assignment_id and a.status='published' and exists(
   select 1 from public.profiles p where p.id=auth.uid() and p.role='student' and coalesce(p.access_approved,false)=true
    and (p.access_expires_at is null or p.access_expires_at>now())
  ) and (
   (a.class_id is not null and exists(select 1 from public.class_enrolments ce where ce.class_id=a.class_id and ce.student_id=auth.uid()))
   or (a.cohort_id is not null and exists(select 1 from public.course_enrolments ce where ce.cohort_id=a.cohort_id and ce.student_id=auth.uid() and ce.status='active'))
   or (a.course_id is not null and exists(select 1 from public.course_enrolments ce where ce.course_id=a.course_id and ce.student_id=auth.uid() and ce.status='active'))
   or (a.class_id is null and a.cohort_id is null and sc.id is null and exists(select 1 from public.course_enrolments ce where ce.course_id=a.course_id and ce.student_id=auth.uid() and ce.status='active'))
  )
 );
$$;
create or replace function public.lms_can_teach_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.scheduled_classes sc join public.profiles p on p.id=auth.uid()
  where sc.id=p_class_id and (p.role in ('registrar','admin') or (p.role in ('tutor','teacher') and sc.teacher_id=auth.uid())));
$$;
create or replace function public.lms_student_in_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.class_enrolments ce join public.profiles p on p.id=auth.uid()
  where ce.class_id=p_class_id and ce.student_id=auth.uid() and p.role='student' and coalesce(p.access_approved,false)
  and (p.access_expires_at is null or p.access_expires_at>now()));
$$;

alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.class_attendance enable row level security;
alter table public.class_announcements enable row level security;
grant select,insert,update,delete on public.assignments to authenticated;
grant select,insert,update on public.assignment_submissions to authenticated;
grant select,insert,update on public.class_attendance to authenticated;
grant select,insert,update,delete on public.class_announcements to authenticated;

drop policy if exists lms_assignment_read on public.assignments;
create policy lms_assignment_read on public.assignments for select to authenticated using (public.lms_can_teach_assignment(id) or public.lms_student_can_access_assignment(id));
drop policy if exists lms_assignment_insert on public.assignments;
create policy lms_assignment_insert on public.assignments for insert to authenticated with check (created_by=auth.uid() and (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin')) or (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('tutor','teacher')) and ((class_id is not null and public.lms_can_teach_class(class_id)) or (cohort_id is not null and exists(select 1 from public.course_cohorts cc where cc.id=cohort_id and cc.default_tutor_id=auth.uid())))));
drop policy if exists lms_assignment_update on public.assignments;
create policy lms_assignment_update on public.assignments for update to authenticated using (public.lms_can_teach_assignment(id)) with check (public.lms_can_teach_assignment(id));
drop policy if exists lms_assignment_delete on public.assignments;
create policy lms_assignment_delete on public.assignments for delete to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin')));

drop policy if exists lms_submission_read on public.assignment_submissions;
create policy lms_submission_read on public.assignment_submissions for select to authenticated using (student_id=auth.uid() or public.lms_can_teach_assignment(assignment_id));
drop policy if exists lms_submission_insert on public.assignment_submissions;
create policy lms_submission_insert on public.assignment_submissions for insert to authenticated with check (student_id=auth.uid() and public.lms_student_can_access_assignment(assignment_id));
drop policy if exists lms_submission_update on public.assignment_submissions;
create policy lms_submission_update on public.assignment_submissions for update to authenticated using (
 (student_id=auth.uid() and public.lms_student_can_access_assignment(assignment_id) and result_published=false)
 or public.lms_can_teach_assignment(assignment_id)
) with check (
 (student_id=auth.uid() and public.lms_student_can_access_assignment(assignment_id) and result_published=false)
 or public.lms_can_teach_assignment(assignment_id)
);

drop policy if exists lms_attendance_read on public.class_attendance;
create policy lms_attendance_read on public.class_attendance for select to authenticated using (student_id=auth.uid() or public.lms_can_teach_class(class_id));
drop policy if exists lms_attendance_insert on public.class_attendance;
create policy lms_attendance_insert on public.class_attendance for insert to authenticated with check (public.lms_can_teach_class(class_id) and recorded_by=auth.uid());
drop policy if exists lms_attendance_update on public.class_attendance;
create policy lms_attendance_update on public.class_attendance for update to authenticated using (public.lms_can_teach_class(class_id)) with check (public.lms_can_teach_class(class_id));

drop policy if exists lms_announcement_read on public.class_announcements;
create policy lms_announcement_read on public.class_announcements for select to authenticated using (
 public.lms_is_staff() or (published and (
  (class_id is not null and public.lms_student_in_class(class_id)) or
  (cohort_id is not null and exists(select 1 from public.course_enrolments ce where ce.cohort_id=class_announcements.cohort_id and ce.student_id=auth.uid() and ce.status='active')) or
  (course_id is not null and exists(select 1 from public.course_enrolments ce where ce.course_id=class_announcements.course_id and ce.student_id=auth.uid() and ce.status='active'))
 ))
);
drop policy if exists lms_announcement_insert on public.class_announcements;
create policy lms_announcement_insert on public.class_announcements for insert to authenticated with check (created_by=auth.uid() and (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin')) or (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('tutor','teacher')) and ((class_id is not null and public.lms_can_teach_class(class_id)) or (cohort_id is not null and exists(select 1 from public.course_cohorts cc where cc.id=cohort_id and cc.default_tutor_id=auth.uid())))));
drop policy if exists lms_announcement_update on public.class_announcements;
create policy lms_announcement_update on public.class_announcements for update to authenticated using (created_by=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin'))) with check (created_by=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin')));
drop policy if exists lms_announcement_delete on public.class_announcements;
create policy lms_announcement_delete on public.class_announcements for delete to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin')));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('assignment-files','assignment-files',false,52428800,array['application/pdf','text/plain','image/jpeg','image/png','audio/mpeg','audio/mp4','audio/wav','audio/ogg','video/mp4','video/webm','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword']),
 ('assignment-submissions','assignment-submissions',false,52428800,array['application/pdf','text/plain','image/jpeg','image/png','audio/mpeg','audio/mp4','audio/wav','audio/ogg','video/mp4','video/webm','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])
on conflict(id) do update set public=false,file_size_limit=52428800;

drop policy if exists lms_assignment_files_read on storage.objects;
create policy lms_assignment_files_read on storage.objects for select to authenticated using (
 (bucket_id='assignment-files' and exists(select 1 from public.assignments a where a.attachment_path=name and (public.lms_can_teach_assignment(a.id) or public.lms_student_can_access_assignment(a.id))))
 or (bucket_id='assignment-submissions' and exists(select 1 from public.assignment_submissions s where s.file_path=name and (s.student_id=auth.uid() or public.lms_can_teach_assignment(s.assignment_id))))
);
drop policy if exists lms_assignment_files_insert on storage.objects;
create policy lms_assignment_files_insert on storage.objects for insert to authenticated with check (
 (bucket_id='assignment-files' and exists(select 1 from public.assignments a where a.id=(split_part(name,'/',1))::uuid and public.lms_can_teach_assignment(a.id)))
 or (bucket_id='assignment-submissions' and split_part(name,'/',2)=auth.uid()::text and public.lms_student_can_access_assignment((split_part(name,'/',1))::uuid))
);
drop policy if exists lms_assignment_files_update on storage.objects;
create policy lms_assignment_files_update on storage.objects for update to authenticated using (
 (bucket_id='assignment-files' and exists(select 1 from public.assignments a where a.id=(split_part(name,'/',1))::uuid and public.lms_can_teach_assignment(a.id)))
 or (bucket_id='assignment-submissions' and split_part(name,'/',2)=auth.uid()::text and exists(select 1 from public.assignment_submissions s where s.file_path=name and s.student_id=auth.uid() and not s.result_published))
);
drop policy if exists lms_assignment_files_delete on storage.objects;
create policy lms_assignment_files_delete on storage.objects for delete to authenticated using (
 bucket_id='assignment-files' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin'))
);

create or replace function public.lms_class_roster(p_class_id uuid)
returns table(student_id uuid, full_name text, email text)
language plpgsql stable security definer set search_path=public,auth as $$
begin
 if not public.lms_can_teach_class(p_class_id) then raise exception 'Assigned tutor access required'; end if;
 return query select p.id,coalesce(p.full_name,'Student'),u.email::text
 from public.class_enrolments ce join public.profiles p on p.id=ce.student_id
 join auth.users u on u.id=p.id where ce.class_id=p_class_id order by p.full_name;
end; $$;
revoke all on function public.lms_class_roster(uuid) from public,anon;
grant execute on function public.lms_class_roster(uuid) to authenticated;

-- Prevent a student from changing their own score, feedback, marker or publication flag.
create or replace function public.lms_protect_student_submission_fields()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
 if auth.uid()=old.student_id and not public.lms_can_teach_assignment(old.assignment_id) then
  if new.student_id is distinct from old.student_id
   or new.assignment_id is distinct from old.assignment_id
   or new.score is distinct from old.score
   or new.feedback is distinct from old.feedback
   or new.marked_by is distinct from old.marked_by
   or new.marked_at is distinct from old.marked_at
   or new.result_published is distinct from old.result_published then
    raise exception 'Students may edit only their answer or file before results are published';
  end if;
  if old.result_published then raise exception 'Published submissions cannot be changed'; end if;
 end if;
 return new;
end; $$;
drop trigger if exists lms_protect_student_submission_fields on public.assignment_submissions;
create trigger lms_protect_student_submission_fields before update on public.assignment_submissions
for each row execute function public.lms_protect_student_submission_fields();

create or replace function public.lms_protect_new_student_submission()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
 if new.student_id=auth.uid() and not public.lms_can_teach_assignment(new.assignment_id) then
  new.score:=null; new.feedback:=''; new.marked_by:=null; new.marked_at:=null; new.result_published:=false;
  if new.status not in ('submitted','late') then new.status:='submitted'; end if;
 end if;
 return new;
end; $$;
drop trigger if exists lms_protect_new_student_submission on public.assignment_submissions;
create trigger lms_protect_new_student_submission before insert on public.assignment_submissions
for each row execute function public.lms_protect_new_student_submission();
