-- Sprachenschule course catalogue and course-level enrolment foundation.
-- Apply AFTER the existing 20261024 migrations. Additive only: preserves existing classes and enrolments.

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  language text not null,
  cefr_level text not null check (cefr_level in ('A1','A2','B1','B2','C1','C2')),
  description text not null default '',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.courses(title, language, cefr_level) values
('German A1','German','A1'),('German A2','German','A2'),('German B1','German','B1'),('German B2','German','B2'),('German C1','German','C1'),('German C2','German','C2'),
('French A1','French','A1'),('French A2','French','A2'),('French B1','French','B1'),('French B2','French','B2'),('French C1','French','C1'),('French C2','French','C2'),
('English A1','English','A1'),('English A2','English','A2'),('English B1','English','B1'),('English B2','English','B2'),('English C1','English','C1'),('English C2','English','C2'),
('Spanish A1','Spanish','A1'),('Spanish A2','Spanish','A2'),('Spanish B1','Spanish','B1'),('Spanish B2','Spanish','B2'),('Spanish C1','Spanish','C1'),('Spanish C2','Spanish','C2'),
('Swahili A1','Swahili','A1'),('Swahili A2','Swahili','A2'),('Swahili B1','Swahili','B1'),('Swahili B2','Swahili','B2'),('Swahili C1','Swahili','C1'),('Swahili C2','Swahili','C2')
on conflict (title) do nothing;

create table if not exists public.course_enrolments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  student_id uuid not null references auth.users(id) on delete cascade,
  enrolled_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('pending','active','suspended','completed','withdrawn')),
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id, student_id)
);

alter table public.scheduled_classes add column if not exists course_id uuid references public.courses(id) on delete set null;
update public.scheduled_classes sc set course_id=c.id from public.courses c where sc.course_id is null and sc.level=c.title;

-- Backfill course-level enrolments from existing approved student profiles.
-- This does not remove existing class_enrolments or change existing access dates.
insert into public.course_enrolments(course_id, student_id, status)
select c.id, p.id, case when coalesce(p.access_approved,false) then 'active' else 'pending' end
from public.profiles p join public.courses c on c.title=p.level
where p.role='student'
on conflict (course_id,student_id) do nothing;

create index if not exists course_enrolments_student_status_idx on public.course_enrolments(student_id,status);
create index if not exists scheduled_classes_course_starts_idx on public.scheduled_classes(course_id,starts_at);

alter table public.courses enable row level security;
alter table public.course_enrolments enable row level security;

grant select on public.courses to anon, authenticated;
grant select, insert, update on public.course_enrolments to authenticated;

drop policy if exists "Active courses are readable" on public.courses;
create policy "Active courses are readable" on public.courses for select to anon, authenticated using (is_active=true);

drop policy if exists "Students read own course enrolments" on public.course_enrolments;
create policy "Students read own course enrolments" on public.course_enrolments for select to authenticated using (student_id=auth.uid());

drop policy if exists "Registrars manage course enrolments" on public.course_enrolments;
create policy "Registrars manage course enrolments" on public.course_enrolments for all to authenticated using (
  exists(select 1 from public.registrars r where r.user_id=auth.uid()) or
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin'))
) with check (
  exists(select 1 from public.registrars r where r.user_id=auth.uid()) or
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin'))
);

-- Course creation is registrar-only. Existing public course catalogue is read-only to students/tutors.
drop policy if exists "Registrars manage courses" on public.courses;
create policy "Registrars manage courses" on public.courses for all to authenticated using (
  exists(select 1 from public.registrars r where r.user_id=auth.uid()) or
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin'))
) with check (
  exists(select 1 from public.registrars r where r.user_id=auth.uid()) or
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin'))
);

-- Keep legacy class creation forms working while linking new classes to the catalogue.
create or replace function public.link_scheduled_class_to_course()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.course_id is null and new.level is not null then
    select c.id into new.course_id from public.courses c where c.title=new.level and c.is_active=true limit 1;
  end if;
  return new;
end;
$$;
drop trigger if exists scheduled_classes_link_course on public.scheduled_classes;
create trigger scheduled_classes_link_course before insert or update of level,course_id on public.scheduled_classes
for each row execute function public.link_scheduled_class_to_course();

-- When a course enrolment becomes active, add the student to scheduled classes for that course.
create or replace function public.sync_course_enrolment_to_classes()
returns trigger language plpgsql security definer set search_path=public as $$
declare enrol_by uuid;
begin
  if new.status='active' then
    enrol_by := coalesce(new.enrolled_by, auth.uid());
    insert into public.class_enrolments(class_id,student_id,enrolled_by)
    select sc.id,new.student_id,enrol_by
    from public.scheduled_classes sc
    where sc.course_id=new.course_id
      and not exists(select 1 from public.class_enrolments ce where ce.class_id=sc.id and ce.student_id=new.student_id)
    on conflict (class_id,student_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists course_enrolments_sync_classes on public.course_enrolments;
create trigger course_enrolments_sync_classes after insert or update of status on public.course_enrolments
for each row execute function public.sync_course_enrolment_to_classes();

-- If a class is scheduled after a student has enrolled, add that student to the class.
create or replace function public.sync_class_to_course_enrolments()
returns trigger language plpgsql security definer set search_path=public as $$
declare enrol_by uuid;
begin
  if new.course_id is not null then
    insert into public.class_enrolments(class_id,student_id,enrolled_by)
    select new.id,ce.student_id,coalesce(ce.enrolled_by,auth.uid())
    from public.course_enrolments ce
    where ce.course_id=new.course_id and ce.status='active'
    on conflict (class_id,student_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists scheduled_classes_sync_enrolments on public.scheduled_classes;
create trigger scheduled_classes_sync_enrolments after insert or update of course_id on public.scheduled_classes
for each row execute function public.sync_class_to_course_enrolments();

-- Existing registrar approval updates profiles.access_approved; mirror that state to course enrolments.
create or replace function public.sync_profile_approval_to_course_enrolments()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.role='student' and (tg_op='INSERT' or new.access_approved is distinct from old.access_approved) then
    update public.course_enrolments
       set status=case when coalesce(new.access_approved,false) then 'active' else 'pending' end,
           updated_at=now()
     where student_id=new.id and status in ('pending','active');
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_sync_course_enrolments on public.profiles;
create trigger profiles_sync_course_enrolments after insert or update of access_approved on public.profiles
for each row execute function public.sync_profile_approval_to_course_enrolments();

-- Reconcile already-active enrolments after triggers are installed.
insert into public.class_enrolments(class_id,student_id,enrolled_by)
select sc.id,ce.student_id,coalesce(ce.enrolled_by,ce.student_id)
from public.course_enrolments ce
join public.scheduled_classes sc on sc.course_id=ce.course_id
where ce.status='active'
on conflict (class_id,student_id) do nothing;
