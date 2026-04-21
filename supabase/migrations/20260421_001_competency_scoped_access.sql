create table if not exists public.competency_department_leaders (
  department_id uuid not null references public.competency_departments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (department_id, user_id)
);

alter table public.competency_department_leaders enable row level security;

create or replace function public.current_user_is_competency_admin()
returns boolean
language sql
stable
as $$
  select
    public.current_user_can_manage_competency_permissions()
    or public.current_user_can_manage_competency_catalog();
$$;

create or replace function public.current_user_is_competency_department_leader(target_department_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.competency_department_leaders leaders
    where leaders.department_id = target_department_id
      and leaders.user_id = auth.uid()
  );
$$;

create or replace function public.current_user_can_view_competency_scope(target_department_id uuid, target_group_id uuid)
returns boolean
language sql
stable
as $$
  select
    public.current_user_is_competency_admin()
    or public.current_user_is_competency_department_leader(target_department_id)
    or public.current_user_can_manage_competency_group(target_group_id);
$$;

create or replace function public.current_user_can_access_competency_manager_page()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.competency_group_managers managers
    where managers.user_id = auth.uid()
  )
  or public.current_user_is_competency_admin();
$$;

create or replace function public.current_user_can_access_competency_needs_page()
returns boolean
language sql
stable
as $$
  select
    public.current_user_is_competency_admin()
    or exists (
      select 1
      from public.competency_department_leaders leaders
      where leaders.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.competency_group_managers managers
      where managers.user_id = auth.uid()
    );
$$;

create or replace function public.current_user_can_view_competency_reports()
returns boolean
language sql
stable
as $$
  select public.current_user_can_access_competency_needs_page();
$$;

drop policy if exists "competency_department_leaders_select" on public.competency_department_leaders;
create policy "competency_department_leaders_select"
  on public.competency_department_leaders
  for select
  to authenticated
  using (
    public.current_user_is_competency_admin()
    or public.current_user_is_competency_department_leader(department_id)
  );

drop policy if exists "competency_department_leaders_manage" on public.competency_department_leaders;
create policy "competency_department_leaders_manage"
  on public.competency_department_leaders
  for all
  to authenticated
  using (public.current_user_can_manage_competency_permissions())
  with check (public.current_user_can_manage_competency_permissions());

drop policy if exists "competency_groups_select" on public.competency_groups;
create policy "competency_groups_select"
  on public.competency_groups
  for select
  to authenticated
  using (
    public.current_user_is_competency_admin()
    or public.current_user_is_competency_department_leader(department_id)
    or exists (
      select 1
      from public.competency_group_managers managers
      where managers.group_id = competency_groups.id
        and managers.user_id = auth.uid()
    )
  );

drop policy if exists "competency_group_managers_select" on public.competency_group_managers;
create policy "competency_group_managers_select"
  on public.competency_group_managers
  for select
  to authenticated
  using (
    public.current_user_is_competency_admin()
    or public.current_user_can_manage_competency_group(group_id)
    or exists (
      select 1
      from public.competency_groups groups
      where groups.id = competency_group_managers.group_id
        and public.current_user_is_competency_department_leader(groups.department_id)
    )
  );

drop policy if exists "competency_members_select" on public.competency_members;
create policy "competency_members_select"
  on public.competency_members
  for select
  to authenticated
  using (
    archived_at is null
    and public.current_user_can_view_competency_scope(department_id, group_id)
  );

drop policy if exists "competency_training_events_select" on public.competency_training_events;
create policy "competency_training_events_select"
  on public.competency_training_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.competency_members members
      where members.id = competency_training_events.member_id
        and members.archived_at is null
        and public.current_user_can_view_competency_scope(members.department_id, members.group_id)
    )
  );

drop policy if exists "competency_notification_log_select" on public.competency_notification_log;
create policy "competency_notification_log_select"
  on public.competency_notification_log
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.competency_members members
      where members.id = competency_notification_log.member_id
        and members.archived_at is null
        and public.current_user_can_view_competency_scope(members.department_id, members.group_id)
    )
  );

create or replace function public.competency_training_needs_window(
  p_date_from date,
  p_date_to date,
  p_member_ids uuid[] default null,
  p_group_ids uuid[] default null,
  p_department_ids uuid[] default null,
  p_course_ids uuid[] default null
)
returns table (
  member_id uuid,
  member_number text,
  full_name text,
  department_id uuid,
  department_name text,
  group_id uuid,
  group_name text,
  course_id uuid,
  course_code text,
  course_title text,
  category text,
  latest_gu_completed_on date,
  latest_ru_completed_on date,
  effective_valid_until date,
  status text,
  days_until_due integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    status.member_id,
    status.member_number,
    status.full_name,
    status.department_id,
    status.department_name,
    status.group_id,
    status.group_name,
    status.course_id,
    status.course_code,
    status.course_title,
    status.category,
    status.latest_gu_completed_on,
    status.latest_ru_completed_on,
    status.effective_valid_until,
    status.status,
    status.days_until_due
  from public.competency_member_course_status status
  where public.current_user_can_access_competency_needs_page()
    and public.current_user_can_view_competency_scope(status.department_id, status.group_id)
    and (p_member_ids is null or status.member_id = any (p_member_ids))
    and (p_group_ids is null or status.group_id = any (p_group_ids))
    and (p_department_ids is null or status.department_id = any (p_department_ids))
    and (p_course_ids is null or status.course_id = any (p_course_ids))
    and (
      status.status = 'missing_gu'
      or (
        status.effective_valid_until is not null
        and status.effective_valid_until between p_date_from and p_date_to
      )
      or (
        status.effective_valid_until is not null
        and status.effective_valid_until < p_date_from
      )
    )
  order by status.effective_valid_until nulls first, status.full_name, status.course_title;
$$;
