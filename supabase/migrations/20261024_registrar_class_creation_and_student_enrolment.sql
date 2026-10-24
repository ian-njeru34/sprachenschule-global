-- Registrar class creation and individual student enrolment.
-- Apply after 20261024_classroom_governance_and_materials.sql.

create table if not exists public.class_enrolments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.scheduled_classes(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  enrolled_by uuid not null references auth.users(id),
  enrolled_at timestamptz not null default now(),
  unique(class_id, student_id)
);

alter table public.class_enrolments enable row level security;
revoke all on public.class_enrolments from anon, authenticated;
grant select on public.class_enrolments to authenticated;

drop policy if exists class_enrolments_student_read on public.class_enrolments;
create policy class_enrolments_student_read on public.class_enrolments
for select to authenticated using (student_id=auth.uid() or public.is_school_registrar()
  or exists(select 1 from public.scheduled_classes c where c.id=class_id and c.teacher_id=auth.uid()));

create or replace function public.registrar_create_class(
  p_title text, p_level text, p_starts_at timestamptz, p_duration_minutes integer,
  p_notes text, p_tutor_id uuid
) returns uuid language plpgsql security definer set search_path=public,auth as $$
declare new_class_id uuid; room text;
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  if coalesce(trim(p_title),'')='' then raise exception 'Class title is required'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Choose a future class start time'; end if;
  if p_duration_minutes not in (45,60,90,120) then raise exception 'Choose a valid class duration'; end if;
  if p_tutor_id is not null and not exists(select 1 from public.profiles p where p.id=p_tutor_id and p.role in ('tutor','teacher')) then
    raise exception 'Tutor must be approved before assignment';
  end if;
  room := 'ssg-' || replace(gen_random_uuid()::text,'-','');
  insert into public.scheduled_classes(title,level,teacher_id,starts_at,duration_minutes,room_name,notes,created_by,status)
  values(trim(p_title),trim(p_level),p_tutor_id,p_starts_at,p_duration_minutes,room,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),'scheduled')
  returning id into new_class_id;
  return new_class_id;
end; $$;

create or replace function public.registrar_approved_students()
returns table(student_id uuid, student_name text, student_email text, student_level text)
language plpgsql security definer set search_path=public,auth as $$
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  return query select p.id,coalesce(p.full_name,'Student'),u.email,
    coalesce(to_jsonb(p)->>'level',to_jsonb(p)->>'course_level','')
  from public.profiles p join auth.users u on u.id=p.id
  where coalesce(p.access_approved,false)=true
    and (p.access_expires_at is null or p.access_expires_at>now())
    and coalesce(p.role,'student') not in ('tutor','teacher','registrar','admin')
  order by p.full_name,u.email;
end; $$;

create or replace function public.registrar_class_roster(p_class_id uuid)
returns table(student_id uuid, student_name text, student_email text, student_level text, enrolled boolean)
language plpgsql security definer set search_path=public,auth as $$
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  if not exists(select 1 from public.scheduled_classes c where c.id=p_class_id) then raise exception 'Class not found'; end if;
  return query select p.id,coalesce(p.full_name,'Student'),u.email,
    coalesce(to_jsonb(p)->>'level',to_jsonb(p)->>'course_level',''),
    exists(select 1 from public.class_enrolments e where e.class_id=p_class_id and e.student_id=p.id)
  from public.profiles p join auth.users u on u.id=p.id
  where coalesce(p.access_approved,false)=true
    and (p.access_expires_at is null or p.access_expires_at>now())
    and coalesce(p.role,'student') not in ('tutor','teacher','registrar','admin')
  order by p.full_name,u.email;
end; $$;

create or replace function public.registrar_set_class_enrolment(p_class_id uuid,p_student_id uuid,p_enrolled boolean)
returns boolean language plpgsql security definer set search_path=public,auth as $$
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  if not exists(select 1 from public.scheduled_classes c where c.id=p_class_id) then raise exception 'Class not found'; end if;
  if p_enrolled then
    if not exists(select 1 from public.profiles p where p.id=p_student_id and coalesce(p.access_approved,false)=true
      and (p.access_expires_at is null or p.access_expires_at>now())
      and coalesce(p.role,'student') not in ('tutor','teacher','registrar','admin')) then
      raise exception 'Student must have active approved access before enrolment';
    end if;
    insert into public.class_enrolments(class_id,student_id,enrolled_by) values(p_class_id,p_student_id,auth.uid())
      on conflict(class_id,student_id) do nothing;
  else
    delete from public.class_enrolments where class_id=p_class_id and student_id=p_student_id;
  end if;
  return true;
end; $$;

create or replace function public.student_scheduled_classes()
returns table(id uuid,title text,level text,starts_at timestamptz,duration_minutes integer,room_name text,notes text,status text)
language plpgsql security definer set search_path=public,auth as $$
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and coalesce(p.access_approved,false)=true
    and (p.access_expires_at is null or p.access_expires_at>now())
    and coalesce(p.role,'student') not in ('tutor','teacher','registrar','admin')) then
    raise exception 'Active approved student access required';
  end if;
  return query select c.id,c.title,c.level,c.starts_at,c.duration_minutes,c.room_name,c.notes,c.status
    from public.scheduled_classes c join public.class_enrolments e on e.class_id=c.id
    where e.student_id=auth.uid() and coalesce(c.status,'scheduled')='scheduled'
      and c.starts_at >= now()-interval '2 hours'
    order by c.starts_at;
end; $$;

-- Allow tutors to schedule their own lessons when the deployed RLS policies permit it.
drop policy if exists scheduled_classes_tutor_insert_own on public.scheduled_classes;
create policy scheduled_classes_tutor_insert_own on public.scheduled_classes for insert to authenticated
with check (teacher_id=auth.uid() and created_by=auth.uid() and exists(
  select 1 from public.profiles p where p.id=auth.uid() and p.role in ('tutor','teacher')
));
grant insert on public.scheduled_classes to authenticated;

-- Restrict in-class materials to individually enrolled students, not every student sharing a level.
drop policy if exists class_materials_read_in_live_class on public.class_materials;
create policy class_materials_read_in_live_class on public.class_materials for select to authenticated
using (deleted_at is null and (
  public.is_school_registrar()
  or exists(select 1 from public.scheduled_classes c where c.id=class_id and c.teacher_id=auth.uid())
  or (public.class_session_is_live(class_id) and not is_hidden and exists(
    select 1 from public.class_enrolments e join public.profiles p on p.id=e.student_id
    where e.class_id=class_materials.class_id and e.student_id=auth.uid()
      and coalesce(p.access_approved,false)=true and (p.access_expires_at is null or p.access_expires_at>now())
  ))
));

drop policy if exists class_material_storage_read_live on storage.objects;
create policy class_material_storage_read_live on storage.objects for select to authenticated
using (bucket_id='class-materials' and exists(
  select 1 from public.class_materials m where m.storage_path=name and m.deleted_at is null and (
    public.is_school_registrar()
    or exists(select 1 from public.scheduled_classes c where c.id=m.class_id and c.teacher_id=auth.uid())
    or (public.class_session_is_live(m.class_id) and not m.is_hidden and exists(
      select 1 from public.class_enrolments e join public.profiles p on p.id=e.student_id
      where e.class_id=m.class_id and e.student_id=auth.uid()
        and coalesce(p.access_approved,false)=true and (p.access_expires_at is null or p.access_expires_at>now())
    ))
  )
));

revoke all on function public.registrar_create_class(text,text,timestamptz,integer,text,uuid) from public,anon;
revoke all on function public.registrar_approved_students() from public,anon;
revoke all on function public.registrar_class_roster(uuid) from public,anon;
revoke all on function public.registrar_set_class_enrolment(uuid,uuid,boolean) from public,anon;
revoke all on function public.student_scheduled_classes() from public,anon;
grant execute on function public.registrar_create_class(text,text,timestamptz,integer,text,uuid) to authenticated;
grant execute on function public.registrar_approved_students() to authenticated;
grant execute on function public.registrar_class_roster(uuid) to authenticated;
grant execute on function public.registrar_set_class_enrolment(uuid,uuid,boolean) to authenticated;
grant execute on function public.student_scheduled_classes() to authenticated;
