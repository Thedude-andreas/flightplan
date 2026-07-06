drop view if exists public.competency_member_course_status cascade;

drop table if exists public.competency_notification_log cascade;
drop table if exists public.competency_training_events cascade;
drop table if exists public.competency_members cascade;
drop table if exists public.competency_courses cascade;
drop table if exists public.competency_group_managers cascade;
drop table if exists public.competency_department_leaders cascade;
drop table if exists public.competency_groups cascade;
drop table if exists public.competency_departments cascade;
drop table if exists public.competency_user_permissions cascade;

drop function if exists public.competency_training_needs_window(date, date, uuid[], uuid[], uuid[], uuid[]) cascade;
drop function if exists public.competency_set_valid_until() cascade;
drop function if exists public.current_user_can_access_competency() cascade;
drop function if exists public.current_user_can_access_competency_manager_page() cascade;
drop function if exists public.current_user_can_access_competency_needs_page() cascade;
drop function if exists public.current_user_can_manage_competency_catalog() cascade;
drop function if exists public.current_user_can_manage_competency_group(uuid) cascade;
drop function if exists public.current_user_can_manage_competency_member(uuid) cascade;
drop function if exists public.current_user_can_manage_competency_permissions() cascade;
drop function if exists public.current_user_can_view_competency_reports() cascade;
drop function if exists public.current_user_can_view_competency_scope(uuid, uuid) cascade;
drop function if exists public.current_user_is_competency_admin() cascade;
drop function if exists public.current_user_is_competency_department_leader(uuid) cascade;
