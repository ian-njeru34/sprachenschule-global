-- Correct tutor registration routing and add registrar dashboard account totals.
-- Review deployed profiles columns and run in Supabase SQL Editor.

-- Repair tutor applications for users who registered before this correction,
-- including cases where the Auth trigger did not create the application row.
insert into public.tutor_applications(user_id, full_name, email, phone, language_level, status)
select u.id,
       coalesce(u.raw_user_meta_data->>'full_name',''),
       coalesce(u.email,''),
       u.raw_user_meta_data->>'phone',
       u.raw_user_meta_data->>'level',
       'pending'
from auth.users u
where u.raw_user_meta_data->>'account_type' = 'tutor'
  and not exists (select 1 from public.tutor_applications ta where ta.user_id=u.id and ta.status in ('pending','approved'))
on conflict (user_id) do nothing;

-- Ensure pending tutor applicants are not treated as students in the registrar queue.
update public.profiles p
set role='pending_tutor'
from auth.users u
join public.tutor_applications ta on ta.user_id=u.id
where p.id=u.id
  and u.raw_user_meta_data->>'account_type'='tutor'
  and ta.status='pending'
  and p.role not in ('registrar','admin');

create or replace function public.registrar_dashboard_counts()
returns table(approved_students bigint, approved_tutors bigint, pending_students bigint, pending_tutors bigint)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (
    exists (select 1 from public.registrars r where r.user_id=auth.uid())
    or exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin'))
  ) then
    raise exception 'Registrar access required';
  end if;

  return query
  select
    (select count(*) from public.profiles p
      where p.role='student' and coalesce(p.access_approved,false)=true
        and not exists(select 1 from public.tutor_applications ta where ta.user_id=p.id))::bigint,
    (select count(*) from public.tutor_applications ta where ta.status='approved')::bigint,
    (select count(*) from public.profiles p
      where p.role='student' and coalesce(p.access_approved,false)=false
        and not exists(select 1 from public.tutor_applications ta where ta.user_id=p.id))::bigint,
    (select count(*) from public.tutor_applications ta where ta.status='pending')::bigint;
end;
$$;

revoke all on function public.registrar_dashboard_counts() from public, anon;
grant execute on function public.registrar_dashboard_counts() to authenticated;
