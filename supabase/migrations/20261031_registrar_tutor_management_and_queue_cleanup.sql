-- Registrar tutor creation support, misrouted tutor application repair,
-- expandable approved-student list support, and reliable registrar roster RPCs.
-- Apply after the course/cohort migrations and 20261030_fix_registrar_roster_functions.sql.
-- This migration preserves existing student, course, cohort, class and attendance data.

-- Ensure a known tutor application that was misclassified in the student queue is repaired.
-- The school email below is the specific account reported by the registrar as a tutor applicant.
-- Existing approved/rejected tutor applications are not overwritten by this repair.
insert into public.tutor_applications(user_id, full_name, email, phone, language_level, status)
select u.id,
       coalesce(nullif(u.raw_user_meta_data->>'full_name',''), nullif(p.full_name,''), 'Tutor applicant'),
       coalesce(u.email, p.email, ''),
       coalesce(u.raw_user_meta_data->>'phone', p.phone),
       coalesce(u.raw_user_meta_data->>'language_level', u.raw_user_meta_data->>'level', to_jsonb(p)->>'level'),
       'pending'
from auth.users u
left join public.profiles p on p.id=u.id
where lower(coalesce(u.email,''))='sprachenschuleglobal@gmail.com'
  and not exists (select 1 from public.tutor_applications ta where ta.user_id=u.id and ta.status in ('approved','rejected'))
on conflict (user_id) do nothing;

-- Recover tutor applications whose metadata clearly identifies them as tutors.
insert into public.tutor_applications(user_id, full_name, email, phone, language_level, status)
select u.id,
       coalesce(nullif(u.raw_user_meta_data->>'full_name',''), nullif(p.full_name,''), 'Tutor applicant'),
       coalesce(u.email, p.email, ''),
       coalesce(u.raw_user_meta_data->>'phone', p.phone),
       coalesce(u.raw_user_meta_data->>'language_level', u.raw_user_meta_data->>'level', to_jsonb(p)->>'level'),
       'pending'
from auth.users u
left join public.profiles p on p.id=u.id
where (u.raw_user_meta_data->>'account_type'='tutor' or u.raw_user_meta_data->>'role'='pending_tutor')
  and not exists (select 1 from public.tutor_applications ta where ta.user_id=u.id)
on conflict (user_id) do nothing;

-- Keep pending tutor applicants out of student workflows, including the known misrouted account.
update public.profiles p
set role='pending_tutor', access_approved=false
from public.tutor_applications ta
where ta.user_id=p.id and ta.status='pending'
  and p.role not in ('registrar','admin');

update public.profiles p
set role='pending_tutor', access_approved=false
from auth.users u
where p.id=u.id and lower(coalesce(u.email,''))='sprachenschuleglobal@gmail.com'
  and p.role not in ('registrar','admin')
  and exists(select 1 from public.tutor_applications ta where ta.user_id=u.id and ta.status='pending');

-- New RPC name avoids relying on an unknown legacy registrar_pending_students return signature.
create or replace function public.registrar_pending_students_clean()
returns table(id uuid, full_name text, email text, level text, payment_confirmed boolean)
language plpgsql security definer set search_path=public, auth as $$
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  return query
  select p.id::uuid,
         coalesce(nullif(p.full_name::text,''), 'Student'::text)::text,
         coalesce(u.email, p.email, '')::text,
         coalesce(to_jsonb(p)->>'level', to_jsonb(p)->>'course_level', '')::text,
         (lower(coalesce(to_jsonb(p)->>'payment_confirmed','false')) in ('true','t','yes','1'))::boolean
  from public.profiles p
  join auth.users u on u.id=p.id
  where p.role='student'
    and coalesce(p.access_approved,false)=false
    and not exists(select 1 from public.tutor_applications ta where ta.user_id=p.id)
    and coalesce(u.raw_user_meta_data->>'account_type','')<>'tutor'
    and coalesce(u.raw_user_meta_data->>'role','')<>'pending_tutor'
  order by p.full_name, u.email;
end;
$$;

-- Explicit casts prevent RETURNS TABLE runtime mismatches. Tutor applications are never students.
create or replace function public.registrar_approved_students()
returns table(student_id uuid, student_name text, student_email text, student_level text)
language plpgsql security definer set search_path=public, auth as $$
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  return query
  select p.id::uuid,
         coalesce(nullif(p.full_name::text,''), 'Student'::text)::text,
         coalesce(u.email, p.email, '')::text,
         coalesce(to_jsonb(p)->>'level', to_jsonb(p)->>'course_level', '')::text
  from public.profiles p
  join auth.users u on u.id=p.id
  where p.role='student'
    and coalesce(p.access_approved,false)=true
    and (p.access_expires_at is null or p.access_expires_at>now())
    and not exists(select 1 from public.tutor_applications ta where ta.user_id=p.id)
    and coalesce(u.raw_user_meta_data->>'account_type','')<>'tutor'
    and coalesce(u.raw_user_meta_data->>'role','')<>'pending_tutor'
  order by p.full_name, u.email;
end;
$$;

create or replace function public.registrar_class_roster(p_class_id uuid)
returns table(student_id uuid, student_name text, student_email text, student_level text, enrolled boolean)
language plpgsql security definer set search_path=public, auth as $$
declare class_row public.scheduled_classes%rowtype;
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  select * into class_row from public.scheduled_classes where id=p_class_id;
  if not found then raise exception 'Class not found'; end if;
  return query
  select p.id::uuid,
         coalesce(nullif(p.full_name::text,''), 'Student'::text)::text,
         coalesce(u.email, p.email, '')::text,
         coalesce(to_jsonb(p)->>'level', to_jsonb(p)->>'course_level', '')::text,
         exists(select 1 from public.class_enrolments e where e.class_id=p_class_id and e.student_id=p.id)::boolean
  from public.profiles p
  join auth.users u on u.id=p.id
  where p.role='student'
    and coalesce(p.access_approved,false)=true
    and (p.access_expires_at is null or p.access_expires_at>now())
    and not exists(select 1 from public.tutor_applications ta where ta.user_id=p.id)
    and coalesce(u.raw_user_meta_data->>'account_type','')<>'tutor'
    and coalesce(u.raw_user_meta_data->>'role','')<>'pending_tutor'
    and (class_row.cohort_id is null or exists(
      select 1 from public.course_enrolments ce
      where ce.student_id=p.id and ce.course_id=class_row.course_id
        and ce.cohort_id=class_row.cohort_id and ce.status='active'
    ))
  order by p.full_name, u.email;
end;
$$;

create or replace function public.registrar_dashboard_counts()
returns table(approved_students bigint, approved_tutors bigint, pending_students bigint, pending_tutors bigint)
language plpgsql security definer set search_path=public, auth as $$
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  return query select
    (select count(*) from public.profiles p join auth.users u on u.id=p.id
      where p.role='student' and coalesce(p.access_approved,false)=true
        and (p.access_expires_at is null or p.access_expires_at>now())
        and not exists(select 1 from public.tutor_applications ta where ta.user_id=p.id)
        and coalesce(u.raw_user_meta_data->>'account_type','')<>'tutor')::bigint,
    (select count(*) from public.tutor_applications ta where ta.status='approved')::bigint,
    (select count(*) from public.profiles p join auth.users u on u.id=p.id
      where p.role='student' and coalesce(p.access_approved,false)=false
        and not exists(select 1 from public.tutor_applications ta where ta.user_id=p.id)
        and coalesce(u.raw_user_meta_data->>'account_type','')<>'tutor')::bigint,
    (select count(*) from public.tutor_applications ta where ta.status='pending')::bigint;
end;
$$;

revoke all on function public.registrar_pending_students_clean() from public, anon;
revoke all on function public.registrar_approved_students() from public, anon;
revoke all on function public.registrar_class_roster(uuid) from public, anon;
revoke all on function public.registrar_dashboard_counts() from public, anon;
grant execute on function public.registrar_pending_students_clean() to authenticated;
grant execute on function public.registrar_approved_students() to authenticated;
grant execute on function public.registrar_class_roster(uuid) to authenticated;
grant execute on function public.registrar_dashboard_counts() to authenticated;
