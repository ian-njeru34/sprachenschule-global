-- Allow approved tutors to create lessons for active cohorts and edit their own assigned lessons.
-- Registrars retain cohort management and tutor assignment responsibilities.

create or replace function public.tutor_create_class_for_cohort(
  p_title text,
  p_cohort_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  new_class_id uuid;
  room text;
  cohort_row public.course_cohorts%rowtype;
  course_row public.courses%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('tutor','teacher')) then
    raise exception 'Approved tutor access required';
  end if;
  if coalesce(trim(p_title),'')='' then raise exception 'Class title is required'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Choose a future class start time'; end if;
  if p_duration_minutes not in (45,60,90,120) then raise exception 'Choose a valid class duration'; end if;
  select * into cohort_row from public.course_cohorts where id=p_cohort_id and status='active';
  if not found then raise exception 'Choose an active course cohort'; end if;
  select * into course_row from public.courses where id=cohort_row.course_id and is_active=true;
  if not found then raise exception 'The cohort course is not active'; end if;

  room := 'ssg-' || replace(gen_random_uuid()::text,'-','');
  insert into public.scheduled_classes(title,level,teacher_id,starts_at,duration_minutes,room_name,notes,created_by,status,course_id,cohort_id)
  values(trim(p_title),course_row.title,auth.uid(),p_starts_at,p_duration_minutes,room,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),'scheduled',course_row.id,cohort_row.id)
  returning id into new_class_id;
  return new_class_id;
end;
$$;

create or replace function public.tutor_update_own_class(
  p_class_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_notes text default null
) returns boolean
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('tutor','teacher')) then
    raise exception 'Approved tutor access required';
  end if;
  if coalesce(trim(p_title),'')='' then raise exception 'Class title is required'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Choose a future class start time'; end if;
  if p_duration_minutes not in (45,60,90,120) then raise exception 'Choose a valid class duration'; end if;

  update public.scheduled_classes
     set title=trim(p_title), starts_at=p_starts_at, duration_minutes=p_duration_minutes,
         notes=nullif(trim(coalesce(p_notes,'')), '')
   where id=p_class_id
     and teacher_id=auth.uid()
     and coalesce(status,'scheduled') not in ('cancelled','deleted');
  if not found then raise exception 'Class not found, not assigned to you, or no longer editable'; end if;
  return true;
end;
$$;

revoke all on function public.tutor_create_class_for_cohort(text,uuid,timestamptz,integer,text) from public,anon;
revoke all on function public.tutor_update_own_class(uuid,text,timestamptz,integer,text) from public,anon;
grant execute on function public.tutor_create_class_for_cohort(text,uuid,timestamptz,integer,text) to authenticated;
grant execute on function public.tutor_update_own_class(uuid,text,timestamptz,integer,text) to authenticated;
