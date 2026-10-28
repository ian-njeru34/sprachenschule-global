-- Read-only details for the registrar's expandable Approved tutors panel.
-- Tutor language/CEFR combinations are stored in tutor_applications.language_level
-- as a comma-separated list, e.g. "German C1, English B2".
create or replace function public.registrar_approved_tutor_details()
returns table(
  tutor_id uuid,
  tutor_name text,
  tutor_email text,
  tutor_phone text,
  language_level text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_school_registrar() then
    raise exception 'Registrar access required';
  end if;
  return query
  select p.id::uuid,
         coalesce(nullif(p.full_name::text,''), 'Tutor'::text)::text,
         coalesce(u.email, p.email, '')::text,
         coalesce(p.phone::text, ta.phone::text, '')::text,
         coalesce(nullif(ta.language_level::text,''), nullif(to_jsonb(p)->>'level',''), 'Not specified')::text
  from public.profiles p
  join auth.users u on u.id=p.id
  left join public.tutor_applications ta on ta.user_id=p.id and ta.status='approved'
  where p.role in ('tutor','teacher')
  order by p.full_name nulls last, u.email;
end;
$$;
revoke all on function public.registrar_approved_tutor_details() from public, anon;
grant execute on function public.registrar_approved_tutor_details() to authenticated;
