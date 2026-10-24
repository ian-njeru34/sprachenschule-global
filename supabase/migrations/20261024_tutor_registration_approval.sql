-- Tutor registration and registrar approval workflow.
-- Run in Supabase SQL Editor after checking that public.profiles.role is a text-compatible column.

create table if not exists public.tutor_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  language_level text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

alter table public.tutor_applications enable row level security;
revoke all on public.tutor_applications from anon, authenticated;
grant select on public.tutor_applications to authenticated;

-- A new auth user with account_type=tutor becomes a pending application, never an active tutor.
create or replace function public.capture_tutor_application()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(new.raw_user_meta_data->>'account_type','') = 'tutor' then
    insert into public.tutor_applications(user_id, full_name, email, phone, language_level, status)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name',''),
      coalesce(new.email,''),
      new.raw_user_meta_data->>'phone',
      new.raw_user_meta_data->>'level',
      'pending'
    ) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_tutor_application on auth.users;
create trigger on_auth_user_created_tutor_application
after insert on auth.users
for each row execute function public.capture_tutor_application();

create or replace function public.registrar_pending_tutors()
returns table(id uuid, user_id uuid, full_name text, email text, phone text, language_level text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (
    exists (select 1 from public.registrars r where r.user_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('registrar','admin'))
  ) then
    raise exception 'Registrar access required';
  end if;
  return query
    select ta.id, ta.user_id, ta.full_name, ta.email, ta.phone, ta.language_level, ta.created_at
    from public.tutor_applications ta
    where ta.status = 'pending'
    order by ta.created_at asc;
end;
$$;

create or replace function public.registrar_approve_tutor(application_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare target_user uuid;
begin
  if not (
    exists (select 1 from public.registrars r where r.user_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('registrar','admin'))
  ) then
    raise exception 'Registrar access required';
  end if;
  select user_id into target_user from public.tutor_applications where id = application_id and status = 'pending' for update;
  if target_user is null then raise exception 'Pending tutor application not found'; end if;

  -- Existing profile records are expected to be created by the site's normal profile trigger.
  update public.profiles set role = 'tutor' where id = target_user;
  if not found then raise exception 'Tutor profile is missing; create the profile before approving this application'; end if;

  update public.tutor_applications set status='approved', reviewed_at=now(), reviewed_by=auth.uid() where id=application_id;
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data,'{}'::jsonb) || jsonb_build_object('role','tutor','approval_status','approved') where id=target_user;
  return true;
end;
$$;

revoke all on function public.registrar_pending_tutors() from public, anon;
revoke all on function public.registrar_approve_tutor(uuid) from public, anon;
grant execute on function public.registrar_pending_tutors() to authenticated;
grant execute on function public.registrar_approve_tutor(uuid) to authenticated;
