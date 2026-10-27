-- Sprachenschule cohort support: a course can run multiple independent cohorts.
-- Apply after 20261028_course_catalogue_and_enrolments.sql.
-- Additive/backfill migration. Existing course classes/enrolments are placed in a default cohort per course.

create table if not exists public.course_cohorts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  name text not null,
  code text not null,
  status text not null default 'active' check (status in ('active','paused','completed','archived')),
  default_tutor_id uuid references public.profiles(id) on delete set null,
  starts_on date,
  ends_on date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id, code),
  unique(course_id, name),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

-- Every existing course receives a stable default cohort so existing records are preserved.
insert into public.course_cohorts(course_id,name,code,status)
select c.id,'General Cohort','GENERAL','active' from public.courses c
on conflict (course_id,code) do nothing;

alter table public.course_enrolments add column if not exists cohort_id uuid references public.course_cohorts(id) on delete restrict;
alter table public.scheduled_classes add column if not exists cohort_id uuid references public.course_cohorts(id) on delete set null;

update public.course_enrolments ce set cohort_id=cc.id
from public.course_cohorts cc
where ce.cohort_id is null and cc.course_id=ce.course_id and cc.code='GENERAL';

update public.scheduled_classes sc set cohort_id=cc.id
from public.course_cohorts cc
where sc.cohort_id is null and sc.course_id=cc.course_id and cc.code='GENERAL';

-- Course enrolment is cohort-specific: a student may study the same course in a different cohort later.
alter table public.course_enrolments drop constraint if exists course_enrolments_course_id_student_id_key;
alter table public.course_enrolments drop constraint if exists course_enrolments_cohort_id_student_id_key;
alter table public.course_enrolments alter column cohort_id set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='course_enrolments_cohort_id_student_id_key' and conrelid='public.course_enrolments'::regclass) then
    alter table public.course_enrolments add constraint course_enrolments_cohort_id_student_id_key unique (cohort_id,student_id);
  end if;
end $$;
create index if not exists course_cohorts_course_status_idx on public.course_cohorts(course_id,status);
create index if not exists scheduled_classes_cohort_starts_idx on public.scheduled_classes(cohort_id,starts_at);

alter table public.course_cohorts enable row level security;
grant select on public.course_cohorts to authenticated;
grant insert,update,delete on public.course_cohorts to authenticated;
drop policy if exists "Active cohorts readable by authenticated" on public.course_cohorts;
create policy "Active cohorts readable by authenticated" on public.course_cohorts
for select to authenticated using (status='active' or public.is_school_registrar());
drop policy if exists "Registrars manage cohorts" on public.course_cohorts;
create policy "Registrars manage cohorts" on public.course_cohorts
for all to authenticated using (public.is_school_registrar()) with check (public.is_school_registrar());

-- Cohort options for authenticated dashboard UI. Registrar-only writes are enforced by RLS/RPCs.
create or replace function public.registrar_create_cohort(
  p_course_id uuid, p_name text, p_code text, p_default_tutor_id uuid default null,
  p_starts_on date default null, p_ends_on date default null
) returns uuid language plpgsql security definer set search_path=public,auth as $$
declare new_id uuid; clean_code text;
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  if not exists(select 1 from public.courses where id=p_course_id and is_active=true) then raise exception 'Choose an active course'; end if;
  if coalesce(trim(p_name),'')='' then raise exception 'Cohort name is required'; end if;
  clean_code := upper(regexp_replace(coalesce(trim(p_code),''),'[^A-Za-z0-9_-]','','g'));
  if clean_code='' then raise exception 'Enter a cohort code'; end if;
  if p_default_tutor_id is not null and not exists(select 1 from public.profiles p where p.id=p_default_tutor_id and p.role in ('tutor','teacher')) then raise exception 'Choose an approved tutor'; end if;
  insert into public.course_cohorts(course_id,name,code,default_tutor_id,starts_on,ends_on,created_by)
  values(p_course_id,trim(p_name),clean_code,p_default_tutor_id,p_starts_on,p_ends_on,auth.uid()) returning id into new_id;
  return new_id;
end; $$;

create or replace function public.registrar_create_class_for_cohort(
  p_title text,p_cohort_id uuid,p_starts_at timestamptz,p_duration_minutes integer,p_notes text,p_tutor_id uuid
) returns uuid language plpgsql security definer set search_path=public,auth as $$
declare new_class_id uuid; room text; cohort_row public.course_cohorts%rowtype; course_row public.courses%rowtype; chosen_tutor uuid;
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  if coalesce(trim(p_title),'')='' then raise exception 'Class title is required'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Choose a future class start time'; end if;
  if p_duration_minutes not in (45,60,90,120) then raise exception 'Choose a valid class duration'; end if;
  select * into cohort_row from public.course_cohorts where id=p_cohort_id and status='active';
  if not found then raise exception 'Choose an active cohort'; end if;
  select * into course_row from public.courses where id=cohort_row.course_id and is_active=true;
  chosen_tutor := coalesce(p_tutor_id,cohort_row.default_tutor_id);
  if chosen_tutor is not null and not exists(select 1 from public.profiles p where p.id=chosen_tutor and p.role in ('tutor','teacher')) then raise exception 'Tutor must be approved before assignment'; end if;
  room := 'ssg-' || replace(gen_random_uuid()::text,'-','');
  insert into public.scheduled_classes(title,level,teacher_id,starts_at,duration_minutes,room_name,notes,created_by,status,course_id,cohort_id)
  values(trim(p_title),course_row.title,chosen_tutor,p_starts_at,p_duration_minutes,room,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),'scheduled',course_row.id,cohort_row.id)
  returning id into new_class_id;
  return new_class_id;
end; $$;

-- Enrolment-to-class syncing must match both course AND cohort, never every cohort for a course.
create or replace function public.sync_course_enrolment_to_classes()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare enrol_by uuid;
begin
  if new.status='active' then
    enrol_by := coalesce(new.enrolled_by, auth.uid());
    insert into public.class_enrolments(class_id,student_id,enrolled_by)
    select sc.id,new.student_id,enrol_by from public.scheduled_classes sc
    where sc.course_id=new.course_id and sc.cohort_id=new.cohort_id
      and not exists(select 1 from public.class_enrolments ce where ce.class_id=sc.id and ce.student_id=new.student_id)
    on conflict (class_id,student_id) do nothing;
  end if;
  return new;
end; $$;

create or replace function public.sync_class_to_course_enrolments()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
  if new.course_id is not null and new.cohort_id is not null then
    insert into public.class_enrolments(class_id,student_id,enrolled_by)
    select new.id,ce.student_id,coalesce(ce.enrolled_by,auth.uid()) from public.course_enrolments ce
    where ce.course_id=new.course_id and ce.cohort_id=new.cohort_id and ce.status='active'
    on conflict (class_id,student_id) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists scheduled_classes_sync_enrolments on public.scheduled_classes;
create trigger scheduled_classes_sync_enrolments after insert or update of course_id,cohort_id on public.scheduled_classes
for each row execute function public.sync_class_to_course_enrolments();

-- If an old class is created through the legacy RPC, place it in that course's General Cohort.
create or replace function public.link_scheduled_class_to_course()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.course_id is null and new.level is not null then
    select c.id into new.course_id from public.courses c where c.title=new.level and c.is_active=true limit 1;
  end if;
  if new.cohort_id is null and new.course_id is not null then
    select cc.id into new.cohort_id from public.course_cohorts cc where cc.course_id=new.course_id and cc.code='GENERAL' limit 1;
  end if;
  return new;
end; $$;
drop trigger if exists scheduled_classes_link_course on public.scheduled_classes;
create trigger scheduled_classes_link_course before insert or update of level,course_id,cohort_id on public.scheduled_classes
for each row execute function public.link_scheduled_class_to_course();

-- Enforce that manual class roster additions match the class's cohort.
create or replace function public.registrar_set_class_enrolment(p_class_id uuid,p_student_id uuid,p_enrolled boolean)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare class_row public.scheduled_classes%rowtype;
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  select * into class_row from public.scheduled_classes where id=p_class_id;
  if not found then raise exception 'Class not found'; end if;
  if p_enrolled then
    if not exists(select 1 from public.profiles p where p.id=p_student_id and coalesce(p.access_approved,false)=true
      and (p.access_expires_at is null or p.access_expires_at>now())
      and coalesce(p.role,'student') not in ('tutor','teacher','registrar','admin')) then raise exception 'Student must have active approved access before enrolment'; end if;
    if class_row.cohort_id is not null and not exists(select 1 from public.course_enrolments ce where ce.student_id=p_student_id and ce.course_id=class_row.course_id and ce.cohort_id=class_row.cohort_id and ce.status='active') then
      raise exception 'Student must be actively enrolled in this class cohort first';
    end if;
    insert into public.class_enrolments(class_id,student_id,enrolled_by) values(p_class_id,p_student_id,auth.uid()) on conflict(class_id,student_id) do nothing;
  else
    delete from public.class_enrolments where class_id=p_class_id and student_id=p_student_id;
  end if;
  return true;
end; $$;

-- Registrar can transfer an existing approved student to a different cohort of the same or another course.
-- Future class access from their previous cohort is removed; past class records are preserved.
create or replace function public.registrar_assign_student_to_cohort(p_student_id uuid,p_cohort_id uuid)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare cohort_row public.course_cohorts%rowtype; student_row public.profiles%rowtype;
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  select * into cohort_row from public.course_cohorts where id=p_cohort_id and status='active';
  if not found then raise exception 'Choose an active cohort'; end if;
  select * into student_row from public.profiles where id=p_student_id;
  if not found or coalesce(student_row.role,'student') in ('tutor','teacher','registrar','admin') then raise exception 'Student account not found'; end if;
  if not coalesce(student_row.access_approved,false) or (student_row.access_expires_at is not null and student_row.access_expires_at<=now()) then raise exception 'Student must have active approved learning access'; end if;
  update public.profiles set level=(select title from public.courses where id=cohort_row.course_id) where id=p_student_id;
  update public.course_enrolments set status='withdrawn',updated_at=now()
  where student_id=p_student_id and course_id=cohort_row.course_id and cohort_id<>cohort_row.id and status in ('pending','active');
  delete from public.class_enrolments ce using public.scheduled_classes sc
  where ce.class_id=sc.id and ce.student_id=p_student_id and sc.cohort_id in
    (select cc.id from public.course_cohorts cc where cc.course_id=cohort_row.course_id and cc.id<>cohort_row.id)
    and sc.starts_at>now();
  insert into public.course_enrolments(course_id,cohort_id,student_id,enrolled_by,status)
  values(cohort_row.course_id,cohort_row.id,p_student_id,auth.uid(),'active')
  on conflict (cohort_id,student_id) do update set status='active',enrolled_by=auth.uid(),updated_at=now();
  return true;
end; $$;

-- Cohort-specific roster: do not offer students from other cohorts for this class.
create or replace function public.registrar_class_roster(p_class_id uuid)
returns table(student_id uuid, student_name text, student_email text, student_level text, enrolled boolean)
language plpgsql security definer set search_path=public,auth as $$
declare class_row public.scheduled_classes%rowtype;
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  select * into class_row from public.scheduled_classes where id=p_class_id;
  if not found then raise exception 'Class not found'; end if;
  return query select p.id,coalesce(p.full_name,'Student'),u.email,
    coalesce(to_jsonb(p)->>'level',to_jsonb(p)->>'course_level',''),
    exists(select 1 from public.class_enrolments e where e.class_id=p_class_id and e.student_id=p.id)
  from public.profiles p join auth.users u on u.id=p.id
  where coalesce(p.access_approved,false)=true
    and (p.access_expires_at is null or p.access_expires_at>now())
    and coalesce(p.role,'student') not in ('tutor','teacher','registrar','admin')
    and (class_row.cohort_id is null or exists(select 1 from public.course_enrolments ce where ce.student_id=p.id and ce.course_id=class_row.course_id and ce.cohort_id=class_row.cohort_id and ce.status='active'))
  order by p.full_name,u.email;
end; $$;

-- Remove accidental cross-cohort access for classes that are current or upcoming.
-- Historical class enrolment rows remain intact for recordkeeping.
delete from public.class_enrolments ce using public.scheduled_classes sc
where ce.class_id=sc.id and sc.cohort_id is not null
  and sc.starts_at + make_interval(mins=>coalesce(sc.duration_minutes,60)) >= now()
  and not exists (
    select 1 from public.course_enrolments enrol
    where enrol.student_id=ce.student_id and enrol.course_id=sc.course_id
      and enrol.cohort_id=sc.cohort_id and enrol.status='active'
  );

-- Backfill missing class enrolment links using exact cohort matches only.
insert into public.class_enrolments(class_id,student_id,enrolled_by)
select sc.id,ce.student_id,coalesce(ce.enrolled_by,ce.student_id)
from public.course_enrolments ce join public.scheduled_classes sc on sc.course_id=ce.course_id and sc.cohort_id=ce.cohort_id
where ce.status='active' on conflict (class_id,student_id) do nothing;

revoke all on function public.registrar_create_cohort(uuid,text,text,uuid,date,date) from public,anon;
revoke all on function public.registrar_create_class_for_cohort(text,uuid,timestamptz,integer,text,uuid) from public,anon;
revoke all on function public.registrar_assign_student_to_cohort(uuid,uuid) from public,anon;
revoke all on function public.registrar_set_class_enrolment(uuid,uuid,boolean) from public,anon;
revoke all on function public.registrar_class_roster(uuid) from public,anon;
grant execute on function public.registrar_create_cohort(uuid,text,text,uuid,date,date) to authenticated;
grant execute on function public.registrar_create_class_for_cohort(text,uuid,timestamptz,integer,text,uuid) to authenticated;
grant execute on function public.registrar_assign_student_to_cohort(uuid,uuid) to authenticated;
grant execute on function public.registrar_set_class_enrolment(uuid,uuid,boolean) to authenticated;
grant execute on function public.registrar_class_roster(uuid) to authenticated;
