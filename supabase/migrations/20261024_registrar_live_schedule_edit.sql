-- Registrar scheduling window, editable existing classes, and accurate live-class indicator.
-- Apply after the existing Sprachenschule classroom/registrar migrations.

create table if not exists public.class_presence (
  class_id uuid not null references public.scheduled_classes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (class_id,user_id)
);
alter table public.class_presence enable row level security;
revoke all on public.class_presence from anon, authenticated;

create or replace function public.class_presence_heartbeat(p_room_name text,p_joined boolean default true)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare cid uuid; r text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select c.id,c.room_name into cid,r from public.scheduled_classes c where c.room_name=p_room_name and coalesce(c.status,'scheduled') not in ('cancelled','deleted') limit 1;
  if cid is null then raise exception 'Scheduled class not found'; end if;
  if not (public.is_school_registrar() or exists(select 1 from public.scheduled_classes c where c.id=cid and c.teacher_id=auth.uid()) or exists(select 1 from public.class_enrolments e where e.class_id=cid and e.student_id=auth.uid())) then
    raise exception 'You are not assigned or enrolled in this class';
  end if;
  if p_joined then
    insert into public.class_presence(class_id,user_id,last_seen_at) values(cid,auth.uid(),now())
    on conflict(class_id,user_id) do update set last_seen_at=excluded.last_seen_at;
  else
    delete from public.class_presence where class_id=cid and user_id=auth.uid();
  end if;
  return true;
end; $$;

-- The returned schedule is intentionally limited to 12 hours before start through 6 hours after end.
drop function if exists public.registrar_class_assignment_options();
create function public.registrar_class_assignment_options()
returns table(class_id uuid,class_title text,class_level text,starts_at timestamptz,tutor_id uuid,tutor_name text,
  duration_minutes integer,notes text,room_name text,status text,is_live boolean,live_participants integer)
language plpgsql security definer set search_path=public,auth as $$
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  return query
  select c.id,c.title,c.level,c.starts_at,c.teacher_id,p.full_name,c.duration_minutes,c.notes,c.room_name,coalesce(c.status,'scheduled')::text,
    (exists(select 1 from public.class_presence cp join public.profiles tp on tp.id=cp.user_id where cp.class_id=c.id and cp.last_seen_at>now()-interval '75 seconds' and cp.user_id=c.teacher_id and tp.role in ('tutor','teacher'))
     and exists(select 1 from public.class_presence cp join public.profiles sp on sp.id=cp.user_id where cp.class_id=c.id and cp.last_seen_at>now()-interval '75 seconds' and sp.role not in ('tutor','teacher','registrar','admin'))),
    (select count(*)::integer from public.class_presence cp where cp.class_id=c.id and cp.last_seen_at>now()-interval '75 seconds')
  from public.scheduled_classes c left join public.profiles p on p.id=c.teacher_id
  where now() >= c.starts_at-interval '12 hours'
    and now() <= c.starts_at+make_interval(mins=>coalesce(c.duration_minutes,60))+interval '6 hours'
    and coalesce(c.status,'scheduled') not in ('cancelled','deleted')
  order by c.starts_at desc;
end; $$;

create or replace function public.registrar_update_class(
  p_class_id uuid,p_title text,p_level text,p_starts_at timestamptz,p_duration_minutes integer,p_notes text,p_tutor_id uuid
) returns boolean language plpgsql security definer set search_path=public,auth as $$
begin
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  if coalesce(trim(p_title),'')='' then raise exception 'Class title is required'; end if;
  if p_starts_at is null then raise exception 'Class start time is required'; end if;
  if p_duration_minutes not in (45,60,90,120) then raise exception 'Choose a valid class duration'; end if;
  if p_tutor_id is not null and not exists(select 1 from public.profiles p where p.id=p_tutor_id and p.role in ('tutor','teacher')) then raise exception 'Tutor must be approved before assignment'; end if;
  update public.scheduled_classes set title=trim(p_title),level=trim(p_level),starts_at=p_starts_at,duration_minutes=p_duration_minutes,
    notes=nullif(trim(coalesce(p_notes,'')),''),teacher_id=p_tutor_id
  where id=p_class_id and coalesce(status,'scheduled') not in ('cancelled','deleted');
  if not found then raise exception 'Class not found or no longer editable'; end if;
  return true;
end; $$;

revoke all on function public.class_presence_heartbeat(text,boolean) from public,anon;
revoke all on function public.registrar_class_assignment_options() from public,anon;
revoke all on function public.registrar_update_class(uuid,text,text,timestamptz,integer,text,uuid) from public,anon;
grant execute on function public.class_presence_heartbeat(text,boolean) to authenticated;
grant execute on function public.registrar_class_assignment_options() to authenticated;
grant execute on function public.registrar_update_class(uuid,text,text,timestamptz,integer,text,uuid) to authenticated;
