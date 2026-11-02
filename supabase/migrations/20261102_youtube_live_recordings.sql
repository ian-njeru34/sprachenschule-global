-- Direct private YouTube Live recording destination for scheduled Sprachenschule classes.
-- No Supabase Storage bucket is created or used for video files.

create table if not exists public.class_recordings (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.scheduled_classes(id) on delete cascade,
  egress_id text,
  youtube_broadcast_id text,
  youtube_stream_id text,
  youtube_video_id text,
  youtube_watch_url text,
  status text not null default 'armed',
  requested_by uuid not null references auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  error_message text
);

-- Safe conversion if the earlier, not-yet-deployed Supabase-storage recording migration was applied.
alter table public.class_recordings add column if not exists egress_id text;
alter table public.class_recordings add column if not exists youtube_broadcast_id text;
alter table public.class_recordings add column if not exists youtube_stream_id text;
alter table public.class_recordings add column if not exists youtube_video_id text;
alter table public.class_recordings add column if not exists youtube_watch_url text;
alter table public.class_recordings add column if not exists error_message text;
alter table public.class_recordings drop column if exists storage_path;
alter table public.class_recordings drop constraint if exists class_recordings_status_check;
alter table public.class_recordings add constraint class_recordings_status_check
  check (status in ('armed','starting','live','processing','completed','failed'));

create index if not exists class_recordings_class_created_idx on public.class_recordings(class_id,created_at desc);
create index if not exists class_recordings_active_class_idx on public.class_recordings(class_id,status) where status in ('armed','starting','live','processing');

alter table public.class_recordings enable row level security;
create or replace function public.is_school_registrar()
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.registrars r where r.user_id=auth.uid())
   or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('registrar','admin'));
$$;
drop policy if exists class_recordings_registrar_read on public.class_recordings;
create policy class_recordings_registrar_read on public.class_recordings for select to authenticated using(public.is_school_registrar());
drop policy if exists class_recordings_registrar_insert on public.class_recordings;
create policy class_recordings_registrar_insert on public.class_recordings for insert to authenticated with check(public.is_school_registrar() and requested_by=auth.uid());
drop policy if exists class_recordings_registrar_update on public.class_recordings;
create policy class_recordings_registrar_update on public.class_recordings for update to authenticated using(public.is_school_registrar()) with check(public.is_school_registrar());
drop policy if exists class_recordings_registrar_delete on public.class_recordings;
create policy class_recordings_registrar_delete on public.class_recordings for delete to authenticated using(public.is_school_registrar());

-- Refresh tokens are encrypted by the application before insertion. No client RLS policies are granted.
create table if not exists public.youtube_connections (
  id text primary key check (id = 'primary'),
  connected_by uuid references auth.users(id),
  encrypted_refresh_token text not null,
  channel_title text,
  channel_id text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.youtube_connections enable row level security;
revoke all on public.youtube_connections from anon, authenticated;


-- Ingest URLs contain the private YouTube stream key. They are encrypted and kept
-- in a separate table with no authenticated/anonymous client policies.
create table if not exists public.youtube_live_targets (
  recording_id uuid primary key references public.class_recordings(id) on delete cascade,
  encrypted_ingest_url text not null,
  created_at timestamptz not null default now()
);
alter table public.youtube_live_targets enable row level security;
revoke all on public.youtube_live_targets from anon, authenticated;
