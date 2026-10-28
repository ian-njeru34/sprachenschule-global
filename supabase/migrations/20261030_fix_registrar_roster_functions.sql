-- Fix registrar roster RPCs returning varchar columns where the declared
-- RETURNS TABLE signature requires text. Apply AFTER 20261029_course_cohorts.sql.
-- Additive function replacement; it does not delete student or class data.

create or replace function public.registrar_approved_students()
returns table(student_id uuid, student_name text, student_email text, student_level text)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_school_registrar() then
    raise exception 'Registrar access required';
  end if;

  return query
  select
    p.id::uuid,
    coalesce(p.full_name::text, 'Student'::text)::text,
    u.email::text,
    coalesce(to_jsonb(p)->>'level', to_jsonb(p)->>'course_level', '')::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where coalesce(p.access_approved, false) = true
    and (p.access_expires_at is null or p.access_expires_at > now())
    and coalesce(p.role, 'student') not in ('tutor', 'teacher', 'registrar', 'admin')
  order by p.full_name, u.email;
end;
$$;

create or replace function public.registrar_class_roster(p_class_id uuid)
returns table(student_id uuid, student_name text, student_email text, student_level text, enrolled boolean)
language plpgsql security definer set search_path = public, auth as $$
declare
  class_row public.scheduled_classes%rowtype;
begin
  if not public.is_school_registrar() then
    raise exception 'Registrar access required';
  end if;

  select * into class_row
  from public.scheduled_classes
  where id = p_class_id;

  if not found then
    raise exception 'Class not found';
  end if;

  return query
  select
    p.id::uuid,
    coalesce(p.full_name::text, 'Student'::text)::text,
    u.email::text,
    coalesce(to_jsonb(p)->>'level', to_jsonb(p)->>'course_level', '')::text,
    exists (
      select 1 from public.class_enrolments e
      where e.class_id = p_class_id and e.student_id = p.id
    )::boolean
  from public.profiles p
  join auth.users u on u.id = p.id
  where coalesce(p.access_approved, false) = true
    and (p.access_expires_at is null or p.access_expires_at > now())
    and coalesce(p.role, 'student') not in ('tutor', 'teacher', 'registrar', 'admin')
    and (
      class_row.cohort_id is null
      or exists (
        select 1 from public.course_enrolments ce
        where ce.student_id = p.id
          and ce.course_id = class_row.course_id
          and ce.cohort_id = class_row.cohort_id
          and ce.status = 'active'
      )
    )
  order by p.full_name, u.email;
end;
$$;

revoke all on function public.registrar_approved_students() from public, anon;
revoke all on function public.registrar_class_roster(uuid) from public, anon;
grant execute on function public.registrar_approved_students() to authenticated;
grant execute on function public.registrar_class_roster(uuid) to authenticated;
