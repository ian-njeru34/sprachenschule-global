-- Private storage and registrar-controlled recording queue for scheduled classes.
-- LiveKit Egress writes recordings to this bucket using Supabase S3-compatible credentials.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('class-recordings','class-recordings',false,1073741824,array['video/mp4','video/webm'])
on conflict (id) do update set public=false,file_size_limit=1073741824,
  allowed_mime_types=array['video/mp4','video/webm'];

create table if not exists public.class_recordings (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.scheduled_classes(id) on delete cascade,
  storage_path text unique,
  egress_id text,
  status text not null default 'armed' check(status in ('armed','recording','completed','failed')),
  requested_by uuid not null references auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  error_message text
);
create index if not exists class_recordings_class_created_idx on public.class_recordings(class_id,created_at desc);
alter table public.class_recordings enable row level security;

create or replace function public.is_school_registrar()
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.registrars r where r.user_id=auth.uid())
   or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin'));
$$;

drop policy if exists class_recordings_registrar_read on public.class_recordings;
create policy class_recordings_registrar_read on public.class_recordings for select to authenticated
using(public.is_school_registrar());
drop policy if exists class_recordings_registrar_insert on public.class_recordings;
create policy class_recordings_registrar_insert on public.class_recordings for insert to authenticated
with check(public.is_school_registrar() and requested_by=auth.uid());
drop policy if exists class_recordings_registrar_update on public.class_recordings;
create policy class_recordings_registrar_update on public.class_recordings for update to authenticated
using(public.is_school_registrar()) with check(public.is_school_registrar());
drop policy if exists class_recordings_registrar_delete on public.class_recordings;
create policy class_recordings_registrar_delete on public.class_recordings for delete to authenticated
using(public.is_school_registrar());

-- No client-facing storage policy is created: downloads/deletion are mediated by
-- authenticated server endpoints that verify registrar permissions.
