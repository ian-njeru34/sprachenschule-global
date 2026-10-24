-- Tutor assigned-class access and class-material upload permissions.
-- Apply after the existing classroom governance and individual-enrolment migrations.

-- Return only classes assigned to the signed-in approved tutor/teacher.
-- SECURITY DEFINER lets the function return those rows without requiring a broad
-- direct SELECT policy on scheduled_classes.
CREATE OR REPLACE FUNCTION public.tutor_assigned_classes()
RETURNS TABLE (
  id uuid,
  title text,
  level text,
  starts_at timestamptz,
  duration_minutes integer,
  room_name text,
  notes text,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('tutor', 'teacher')
  ) THEN
    RAISE EXCEPTION 'Approved tutor access required';
  END IF;

  RETURN QUERY
  SELECT c.id, c.title, c.level, c.starts_at,
         COALESCE(c.duration_minutes, 60)::integer,
         c.room_name, c.notes, COALESCE(c.status, 'scheduled')::text
  FROM public.scheduled_classes c
  WHERE c.teacher_id = auth.uid()
  ORDER BY c.starts_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_assigned_classes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tutor_assigned_classes() TO authenticated;

-- A SECURITY DEFINER predicate avoids storage/table policies depending on the
-- caller's direct visibility of scheduled_classes rows.
CREATE OR REPLACE FUNCTION public.is_assigned_tutor_to_class(p_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.scheduled_classes c
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE c.id = p_class_id
      AND c.teacher_id = auth.uid()
      AND p.role IN ('tutor', 'teacher')
  );
$$;

REVOKE ALL ON FUNCTION public.is_assigned_tutor_to_class(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_tutor_to_class(uuid) TO authenticated;

-- Ensure the private bucket exists and retains a 50 MB limit.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'class-materials', 'class-materials', false, 52428800,
  ARRAY['application/pdf','text/plain','audio/mpeg','audio/mp4','audio/wav','audio/ogg','video/mp4','video/webm','video/quicktime']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 52428800,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Tutors can read material records and upload to classes assigned to them.
DROP POLICY IF EXISTS class_materials_read_in_live_class ON public.class_materials;
CREATE POLICY class_materials_read_in_live_class
ON public.class_materials FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    public.is_school_registrar()
    OR public.is_assigned_tutor_to_class(class_id)
    OR (
      public.class_session_is_live(class_id)
      AND NOT is_hidden
      AND EXISTS (
        SELECT 1
        FROM public.class_enrolments e
        JOIN public.profiles p ON p.id = e.student_id
        WHERE e.class_id = class_materials.class_id
          AND e.student_id = auth.uid()
          AND COALESCE(p.access_approved, false) = true
          AND (p.access_expires_at IS NULL OR p.access_expires_at > now())
      )
    )
  )
);

DROP POLICY IF EXISTS class_materials_tutor_upload_assigned_class ON public.class_materials;
CREATE POLICY class_materials_tutor_upload_assigned_class
ON public.class_materials FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND public.is_assigned_tutor_to_class(class_id)
);

DROP POLICY IF EXISTS class_materials_tutor_hide_assigned ON public.class_materials;
CREATE POLICY class_materials_tutor_hide_assigned
ON public.class_materials FOR UPDATE TO authenticated
USING (
  public.is_assigned_tutor_to_class(class_id)
  AND uploaded_by = auth.uid()
  AND deleted_at IS NULL
)
WITH CHECK (
  public.is_assigned_tutor_to_class(class_id)
  AND uploaded_by = auth.uid()
  AND deleted_at IS NULL
);

-- Tutor may upload new objects only into a class folder assigned to them.
DROP POLICY IF EXISTS class_material_storage_upload_assigned ON storage.objects;
CREATE POLICY class_material_storage_upload_assigned
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'class-materials'
  AND public.is_assigned_tutor_to_class((split_part(name, '/', 1))::uuid)
);

-- Tutors can access their own class files. Enrolled students can read files only
-- while the class session is live and the material is not hidden.
DROP POLICY IF EXISTS class_material_storage_read_live ON storage.objects;
CREATE POLICY class_material_storage_read_live
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'class-materials'
  AND EXISTS (
    SELECT 1
    FROM public.class_materials m
    WHERE m.storage_path = name
      AND m.deleted_at IS NULL
      AND (
        public.is_school_registrar()
        OR public.is_assigned_tutor_to_class(m.class_id)
        OR (
          public.class_session_is_live(m.class_id)
          AND NOT m.is_hidden
          AND EXISTS (
            SELECT 1
            FROM public.class_enrolments e
            JOIN public.profiles p ON p.id = e.student_id
            WHERE e.class_id = m.class_id
              AND e.student_id = auth.uid()
              AND COALESCE(p.access_approved, false) = true
              AND (p.access_expires_at IS NULL OR p.access_expires_at > now())
          )
        )
      )
  )
);

GRANT SELECT, INSERT ON public.class_materials TO authenticated;
GRANT UPDATE (is_hidden, hidden_at) ON public.class_materials TO authenticated;
NOTIFY pgrst, 'reload schema';
