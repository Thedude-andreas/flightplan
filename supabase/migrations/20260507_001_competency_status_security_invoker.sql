-- Ensure the status view is evaluated with the querying user's permissions/RLS.
alter view public.competency_member_course_status
  set (security_invoker = true);
