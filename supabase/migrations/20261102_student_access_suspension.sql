-- Sprachenschule: registrar-controlled live-class access suspension.
-- Run in Supabase SQL Editor before deploying the matching website update.
alter table public.profiles
  add column if not exists access_suspended boolean not null default false;

comment on column public.profiles.access_suspended is
  'When true, the student cannot obtain a LiveKit classroom token; distinct from approval status.';
