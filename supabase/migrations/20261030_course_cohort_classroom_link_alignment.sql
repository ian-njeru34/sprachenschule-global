-- Keep student timetable entries tied to the exact scheduled class and expose
-- its canonical course/cohort label. The class ID and room name are returned
-- together so student links cannot accidentally point at another cohort's room.

create or replace function public.student_scheduled_classes_with_course_cohort()
returns table(
  id uuid,
  title text,
  level text,
  starts_at timestamptz,
  duration_minutes integer,
  room_name text,
  notes text,
  status text,
  course_title text,
  cohort_name text,
  cohort_code text
)
language plpgsql
stable
security definer
set search_path=public,auth
as $$
begin
  if not exists(
    select 1 from public.profiles p
    where p.id=auth.uid()
      and coalesce(p.access_approved,false)=true
      and (p.access_expires_at is null or p.access_expires_at>now())
      and coalesce(p.role,'student') not in ('tutor','teacher','registrar','admin')
  ) then
    raise exception 'Active approved student access required';
  end if;

  return query
  select
    c.id,
    c.title,
    c.level,
    c.starts_at,
    coalesce(c.duration_minutes,60)::integer,
    c.room_name,
    c.notes,
    coalesce(c.status,'scheduled')::text,
    coalesce(course.title,c.level)::text,
    cohort.name::text,
    cohort.code::text
  from public.scheduled_classes c
  join public.class_enrolments e on e.class_id=c.id and e.student_id=auth.uid()
  left join public.courses course on course.id=c.course_id
  left join public.course_cohorts cohort on cohort.id=c.cohort_id
  where coalesce(c.status,'scheduled')='scheduled'
    and c.starts_at >= now()-interval '2 hours'
  order by c.starts_at;
end;
$$;

revoke all on function public.student_scheduled_classes_with_course_cohort() from public,anon;
grant execute on function public.student_scheduled_classes_with_course_cohort() to authenticated;
