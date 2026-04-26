update public.competency_user_permissions
set
  manage_catalog = false,
  view_reports = false,
  manage_permissions = false
where module_access = false
  and (manage_catalog = true or view_reports = true or manage_permissions = true);

alter table public.competency_user_permissions
  drop constraint if exists competency_user_permissions_module_access_required_for_roles;

alter table public.competency_user_permissions
  add constraint competency_user_permissions_module_access_required_for_roles
  check (
    module_access = true
    or (manage_catalog = false and view_reports = false and manage_permissions = false)
  );

create or replace function public.current_user_can_access_competency()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.competency_user_permissions permissions
    where permissions.user_id = auth.uid()
      and permissions.module_access = true
  );
$$;

create or replace function public.current_user_can_manage_competency_catalog()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.competency_user_permissions permissions
    where permissions.user_id = auth.uid()
      and permissions.module_access = true
      and permissions.manage_catalog = true
  );
$$;

create or replace function public.current_user_can_manage_competency_permissions()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.competency_user_permissions permissions
    where permissions.user_id = auth.uid()
      and permissions.module_access = true
      and permissions.manage_permissions = true
  );
$$;

create or replace function public.current_user_is_competency_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_can_manage_competency_permissions()
    or public.current_user_can_manage_competency_catalog();
$$;

create or replace function public.current_user_is_competency_department_leader(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_access_competency()
    and exists (
      select 1
      from public.competency_department_leaders leaders
      where leaders.department_id = target_department_id
        and leaders.user_id = auth.uid()
    );
$$;

create or replace function public.current_user_can_manage_competency_group(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_access_competency()
    and (
      public.current_user_can_manage_competency_permissions()
      or public.current_user_can_manage_competency_catalog()
      or exists (
        select 1
        from public.competency_group_managers managers
        where managers.group_id = target_group_id
          and managers.user_id = auth.uid()
      )
    );
$$;

create or replace function public.current_user_can_view_competency_scope(target_department_id uuid, target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_access_competency()
    and (
      public.current_user_is_competency_admin()
      or public.current_user_is_competency_department_leader(target_department_id)
      or public.current_user_can_manage_competency_group(target_group_id)
    );
$$;

create or replace function public.current_user_can_access_competency_manager_page()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_access_competency()
    and (
      exists (
        select 1
        from public.competency_group_managers managers
        where managers.user_id = auth.uid()
      )
      or public.current_user_is_competency_admin()
    );
$$;

create or replace function public.current_user_can_access_competency_needs_page()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_access_competency()
    and (
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
      )
    );
$$;

create or replace function public.current_user_can_view_competency_reports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_access_competency_needs_page();
$$;

create or replace function public.current_user_can_manage_competency_member(target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_access_competency()
    and exists (
      select 1
      from public.competency_members members
      where members.id = target_member_id
        and members.archived_at is null
        and public.current_user_can_manage_competency_group(members.group_id)
    );
$$;

drop policy if exists "competency_department_leaders_select" on public.competency_department_leaders;
create policy "competency_department_leaders_select"
  on public.competency_department_leaders
  for select
  to authenticated
  using (
    public.current_user_can_access_competency()
    and (
      public.current_user_is_competency_admin()
      or user_id = auth.uid()
    )
  );

drop policy if exists "competency_department_leaders_manage" on public.competency_department_leaders;
create policy "competency_department_leaders_manage"
  on public.competency_department_leaders
  for all
  to authenticated
  using (public.current_user_can_manage_competency_permissions())
  with check (
    public.current_user_can_manage_competency_permissions()
    and exists (
      select 1
      from public.competency_user_permissions permissions
      where permissions.user_id = competency_department_leaders.user_id
        and permissions.module_access = true
    )
  );

drop policy if exists "competency_groups_select" on public.competency_groups;
create policy "competency_groups_select"
  on public.competency_groups
  for select
  to authenticated
  using (
    public.current_user_can_access_competency()
    and (
      public.current_user_is_competency_admin()
      or public.current_user_is_competency_department_leader(department_id)
      or exists (
        select 1
        from public.competency_group_managers managers
        where managers.group_id = competency_groups.id
          and managers.user_id = auth.uid()
      )
    )
  );

drop policy if exists "competency_group_managers_select" on public.competency_group_managers;
create policy "competency_group_managers_select"
  on public.competency_group_managers
  for select
  to authenticated
  using (
    public.current_user_can_access_competency()
    and (
      public.current_user_is_competency_admin()
      or user_id = auth.uid()
      or exists (
        select 1
        from public.competency_groups groups
        where groups.id = competency_group_managers.group_id
          and public.current_user_is_competency_department_leader(groups.department_id)
      )
    )
  );

drop policy if exists "competency_group_managers_manage" on public.competency_group_managers;
create policy "competency_group_managers_manage"
  on public.competency_group_managers
  for all
  to authenticated
  using (public.current_user_can_manage_competency_permissions())
  with check (
    public.current_user_can_manage_competency_permissions()
    and exists (
      select 1
      from public.competency_user_permissions permissions
      where permissions.user_id = competency_group_managers.user_id
        and permissions.module_access = true
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
