-- Allow tutors to permanently delete only their own scheduled classes.
-- Allow registrar/admin users to permanently delete any scheduled class.
-- Material records and dependent attendance/enrolment rows cascade where schema FKs specify it.
create or replace function public.tutor_delete_own_class(p_class_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('tutor','teacher')) then
    raise exception 'Approved tutor access required';
  end if;
  delete from public.scheduled_classes
   where id=p_class_id and teacher_id=auth.uid();
  if not found then raise exception 'Class not found or not created by your tutor account'; end if;
  return true;
end;
$$;

create or replace function public.registrar_delete_scheduled_class(p_class_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_school_registrar() then raise exception 'Registrar access required'; end if;
  delete from public.scheduled_classes where id=p_class_id;
  if not found then raise exception 'Scheduled class not found'; end if;
  return true;
end;
$$;

revoke all on function public.tutor_delete_own_class(uuid) from public,anon;
revoke all on function public.registrar_delete_scheduled_class(uuid) from public,anon;
grant execute on function public.tutor_delete_own_class(uuid) to authenticated;
grant execute on function public.registrar_delete_scheduled_class(uuid) to authenticated;
