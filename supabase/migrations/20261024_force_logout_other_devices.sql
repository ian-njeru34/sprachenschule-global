-- Allow a signed-in user to replace their own single-device lease when choosing
-- "Log out other devices and continue". Existing acquire/heartbeat RPCs remain in use.
-- This function only deletes session-lease rows for auth.uid(), never another user.

CREATE OR REPLACE FUNCTION public.force_acquire_student_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  target_table text;
  user_column text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT t.table_name,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='user_id') THEN 'user_id'
              WHEN EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='student_id') THEN 'student_id'
              ELSE NULL END
    INTO target_table, user_column
  FROM information_schema.tables t
  WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
    AND (t.table_name ILIKE '%student_session%' OR t.table_name ILIKE '%active_session%' OR t.table_name ILIKE '%user_session%')
    AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='session_id')
    AND (EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='user_id')
      OR EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='student_id'))
  ORDER BY CASE t.table_name WHEN 'student_sessions' THEN 1 WHEN 'active_student_sessions' THEN 2 WHEN 'user_sessions' THEN 3 WHEN 'active_sessions' THEN 4 ELSE 10 END
  LIMIT 1;

  IF target_table IS NULL OR user_column IS NULL THEN
    RAISE EXCEPTION 'Could not locate the configured single-device session table';
  END IF;

  EXECUTE format('DELETE FROM public.%I WHERE %I = $1', target_table, user_column) USING auth.uid();
  RETURN public.acquire_student_session(p_session_id);
END;
$$;

REVOKE ALL ON FUNCTION public.force_acquire_student_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.force_acquire_student_session(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
