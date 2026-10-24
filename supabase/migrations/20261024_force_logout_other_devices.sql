-- Device-session support for student, tutor, and staff accounts.
-- Safe to re-run. This creates its own table instead of guessing an existing table name.

CREATE TABLE IF NOT EXISTS public.account_device_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_device_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_device_sessions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.acquire_student_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  claimed integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF p_session_id IS NULL THEN RAISE EXCEPTION 'Session ID required'; END IF;

  INSERT INTO public.account_device_sessions(user_id, session_id, last_seen_at)
  VALUES (uid, p_session_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET session_id = EXCLUDED.session_id, last_seen_at = now()
    WHERE public.account_device_sessions.session_id = EXCLUDED.session_id
       OR public.account_device_sessions.last_seen_at < now() - interval '90 seconds';
  GET DIAGNOSTICS claimed = ROW_COUNT;
  RETURN claimed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_student_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE touched integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  UPDATE public.account_device_sessions
     SET last_seen_at = now()
   WHERE user_id = auth.uid() AND session_id = p_session_id;
  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_student_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE removed integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  DELETE FROM public.account_device_sessions
   WHERE user_id = auth.uid() AND session_id = p_session_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.force_acquire_student_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF p_session_id IS NULL THEN RAISE EXCEPTION 'Session ID required'; END IF;
  -- The authenticated user can replace only their own session record.
  DELETE FROM public.account_device_sessions WHERE user_id = auth.uid();
  INSERT INTO public.account_device_sessions(user_id, session_id, last_seen_at)
  VALUES (auth.uid(), p_session_id, now());
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_student_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heartbeat_student_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_student_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.force_acquire_student_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_student_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_student_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_student_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_acquire_student_session(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
