-- Automatically grant a student access to scheduled classes in their assigned cohort
-- when the registrar approves the student's account. No per-class roster editing is needed.

create or replace function public.sync_student_cohort_to_scheduled_classes()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.status = 'active' and new.course_id is not null and new.cohort_id is not null then
    insert into public.class_enrolments (class_id, student_id, enrolled_by)
    select sc.id, new.student_id, coalesce(new.enrolled_by, new.student_id)
    from public.scheduled_classes sc
    where sc.course_id = new.course_id
      and sc.cohort_id = new.cohort_id
    on conflict (class_id, student_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists course_enrolments_sync_scheduled_classes on public.course_enrolments;
create trigger course_enrolments_sync_scheduled_classes
after insert or update of status, course_id, cohort_id, student_id
on public.course_enrolments
for each row
execute function public.sync_student_cohort_to_scheduled_classes();

-- Existing student enrolments become active when the registrar approves the profile.
create or replace function public.activate_student_cohort_enrolment_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(new.access_approved, false) = true
     and coalesce(old.access_approved, false) = false then
    update public.course_enrolments
       set status = 'active', updated_at = now()
     where student_id = new.id
       and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_activate_cohort_enrolment on public.profiles;
create trigger profiles_activate_cohort_enrolment
after update of access_approved on public.profiles
for each row
execute function public.activate_student_cohort_enrolment_on_approval();

-- Backfill active enrolments so currently approved cohort students also receive access.
insert into public.class_enrolments (class_id, student_id, enrolled_by)
select sc.id, ce.student_id, coalesce(ce.enrolled_by, ce.student_id)
from public.scheduled_classes sc
join public.course_enrolments ce
  on ce.course_id = sc.course_id
 and ce.cohort_id = sc.cohort_id
where ce.status = 'active'
on conflict (class_id, student_id) do nothing;

revoke all on function public.sync_student_cohort_to_scheduled_classes() from public, anon, authenticated;
revoke all on function public.activate_student_cohort_enrolment_on_approval() from public, anon, authenticated;
