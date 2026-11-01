-- Registrar class management must show the full historical and future schedule.
-- Remove the 12-hours-before / 6-hours-after display window from the registrar RPC.
-- Classroom join/access rules and LIVE presence detection remain unchanged.

CREATE OR REPLACE FUNCTION public.registrar_class_assignment_options()
RETURNS TABLE(
  class_id uuid,
  class_title text,
  class_level text,
  starts_at timestamptz,
  tutor_id uuid,
  tutor_name text,
  duration_minutes integer,
  notes text,
  room_name text,
  status text,
  is_live boolean,
  live_participants integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_school_registrar() THEN
    RAISE EXCEPTION 'Registrar access required';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.title,
    c.level,
    c.starts_at,
    c.teacher_id,
    p.full_name,
    c.duration_minutes,
    c.notes,
    c.room_name,
    COALESCE(c.status, 'scheduled')::text,
    (
      EXISTS (
        SELECT 1
        FROM public.class_presence cp
        JOIN public.profiles tp ON tp.id = cp.user_id
        WHERE cp.class_id = c.id
          AND cp.last_seen_at > now() - interval '75 seconds'
          AND cp.user_id = c.teacher_id
          AND tp.role IN ('tutor', 'teacher')
      )
      AND EXISTS (
        SELECT 1
        FROM public.class_presence cp
        JOIN public.profiles sp ON sp.id = cp.user_id
        WHERE cp.class_id = c.id
          AND cp.last_seen_at > now() - interval '75 seconds'
          AND sp.role NOT IN ('tutor', 'teacher', 'registrar', 'admin')
      )
    ),
    (
      SELECT count(*)::integer
      FROM public.class_presence cp
      WHERE cp.class_id = c.id
        AND cp.last_seen_at > now() - interval '75 seconds'
    )
  FROM public.scheduled_classes c
  LEFT JOIN public.profiles p ON p.id = c.teacher_id
  WHERE COALESCE(c.status, 'scheduled') NOT IN ('cancelled', 'deleted')
  ORDER BY c.starts_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_class_assignment_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_class_assignment_options() TO authenticated;
