create table if not exists public.competency_user_permissions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  module_access boolean not null default false,
  manage_catalog boolean not null default false,
  view_reports boolean not null default false,
  manage_permissions boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competency_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competency_groups (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.competency_departments(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create table if not exists public.competency_group_managers (
  group_id uuid not null references public.competency_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.competency_courses (
  id uuid primary key default gen_random_uuid(),
  course_code text not null unique,
  title text not null,
  category text not null,
  description text,
  gu_validity_months integer check (gu_validity_months is null or gu_validity_months > 0),
  ru_validity_months integer check (ru_validity_months is null or ru_validity_months > 0),
  notification_lead_days integer not null default 30 check (notification_lead_days >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competency_members (
  id uuid primary key default gen_random_uuid(),
  member_number text,
  full_name text not null,
  email text,
  phone text,
  department_id uuid not null references public.competency_departments(id) on delete restrict,
  group_id uuid not null references public.competency_groups(id) on delete restrict,
  notes text,
  archived_at timestamptz,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competency_training_events (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.competency_members(id) on delete cascade,
  course_id uuid not null references public.competency_courses(id) on delete cascade,
  training_kind text not null check (training_kind in ('gu', 'ru')),
  completed_on date not null,
  valid_until date,
  note text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competency_notification_log (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.competency_members(id) on delete cascade,
  course_id uuid not null references public.competency_courses(id) on delete cascade,
  due_on date,
  recipient_email text not null,
  delivery_status text not null default 'queued' check (delivery_status in ('queued', 'sent', 'failed')),
  delivery_error text,
  sent_at timestamptz not null default now()
);

create index if not exists competency_members_group_idx
  on public.competency_members (group_id, full_name)
  where archived_at is null;

create index if not exists competency_members_department_idx
  on public.competency_members (department_id, full_name)
  where archived_at is null;

create index if not exists competency_training_events_member_course_idx
  on public.competency_training_events (member_id, course_id, completed_on desc);

create index if not exists competency_training_events_course_idx
  on public.competency_training_events (course_id, completed_on desc);

drop trigger if exists set_competency_user_permissions_updated_at on public.competency_user_permissions;
create trigger set_competency_user_permissions_updated_at
  before update on public.competency_user_permissions
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_competency_departments_updated_at on public.competency_departments;
create trigger set_competency_departments_updated_at
  before update on public.competency_departments
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_competency_groups_updated_at on public.competency_groups;
create trigger set_competency_groups_updated_at
  before update on public.competency_groups
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_competency_courses_updated_at on public.competency_courses;
create trigger set_competency_courses_updated_at
  before update on public.competency_courses
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_competency_members_updated_at on public.competency_members;
create trigger set_competency_members_updated_at
  before update on public.competency_members
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_competency_training_events_updated_at on public.competency_training_events;
create trigger set_competency_training_events_updated_at
  before update on public.competency_training_events
  for each row execute procedure public.set_updated_at();

create or replace function public.current_user_can_access_competency()
returns boolean
language sql
stable
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
as $$
  select exists (
    select 1
    from public.competency_user_permissions permissions
    where permissions.user_id = auth.uid()
      and permissions.module_access = true
      and permissions.manage_catalog = true
  );
$$;

create or replace function public.current_user_can_view_competency_reports()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.competency_user_permissions permissions
    where permissions.user_id = auth.uid()
      and permissions.module_access = true
      and (permissions.view_reports = true or permissions.manage_catalog = true or permissions.manage_permissions = true)
  );
$$;

create or replace function public.current_user_can_manage_competency_permissions()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.competency_user_permissions permissions
    where permissions.user_id = auth.uid()
      and permissions.module_access = true
      and permissions.manage_permissions = true
  );
$$;

create or replace function public.current_user_can_manage_competency_group(target_group_id uuid)
returns boolean
language sql
stable
as $$
  select
    public.current_user_can_manage_competency_permissions()
    or public.current_user_can_manage_competency_catalog()
    or exists (
      select 1
      from public.competency_group_managers managers
      where managers.group_id = target_group_id
        and managers.user_id = auth.uid()
    );
$$;

create or replace function public.current_user_can_manage_competency_member(target_member_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.competency_members members
    where members.id = target_member_id
      and members.archived_at is null
      and public.current_user_can_manage_competency_group(members.group_id)
  );
$$;

create or replace function public.competency_set_valid_until()
returns trigger
language plpgsql
as $$
declare
  course_record public.competency_courses%rowtype;
  validity_months integer;
begin
  select *
  into course_record
  from public.competency_courses
  where id = new.course_id;

  if not found then
    raise exception 'Ogiltig kurs %', new.course_id;
  end if;

  validity_months :=
    case
      when new.training_kind = 'gu' then course_record.gu_validity_months
      else course_record.ru_validity_months
    end;

  if validity_months is null then
    new.valid_until := null;
  else
    new.valid_until := ((new.completed_on + make_interval(months => validity_months))::date - 1);
  end if;

  if new.created_by_user_id is null then
    new.created_by_user_id := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists competency_training_events_set_valid_until on public.competency_training_events;
create trigger competency_training_events_set_valid_until
  before insert or update of course_id, training_kind, completed_on
  on public.competency_training_events
  for each row execute procedure public.competency_set_valid_until();

create or replace view public.competency_member_course_status as
with active_members as (
  select
    members.id as member_id,
    members.member_number,
    members.full_name,
    members.email,
    members.phone,
    members.department_id,
    departments.name as department_name,
    members.group_id,
    groups.name as group_name
  from public.competency_members members
  join public.competency_departments departments on departments.id = members.department_id
  join public.competency_groups groups on groups.id = members.group_id
  where members.archived_at is null
),
latest_gu as (
  select distinct on (events.member_id, events.course_id)
    events.member_id,
    events.course_id,
    events.completed_on,
    events.valid_until
  from public.competency_training_events events
  where events.training_kind = 'gu'
  order by events.member_id, events.course_id, events.completed_on desc, events.created_at desc
),
latest_ru as (
  select distinct on (events.member_id, events.course_id)
    events.member_id,
    events.course_id,
    events.completed_on,
    events.valid_until
  from public.competency_training_events events
  where events.training_kind = 'ru'
  order by events.member_id, events.course_id, events.completed_on desc, events.created_at desc
)
select
  members.member_id,
  members.member_number,
  members.full_name,
  members.email,
  members.phone,
  members.department_id,
  members.department_name,
  members.group_id,
  members.group_name,
  courses.id as course_id,
  courses.course_code,
  courses.title as course_title,
  courses.category,
  courses.notification_lead_days,
  courses.gu_validity_months,
  courses.ru_validity_months,
  latest_gu.completed_on as latest_gu_completed_on,
  latest_gu.valid_until as latest_gu_valid_until,
  latest_ru.completed_on as latest_ru_completed_on,
  latest_ru.valid_until as latest_ru_valid_until,
  coalesce(latest_ru.valid_until, latest_gu.valid_until) as effective_valid_until,
  case
    when latest_gu.completed_on is null then 'missing_gu'
    when coalesce(latest_ru.valid_until, latest_gu.valid_until) is null then 'valid'
    when coalesce(latest_ru.valid_until, latest_gu.valid_until) < current_date then 'expired'
    when coalesce(latest_ru.valid_until, latest_gu.valid_until) <= current_date + courses.notification_lead_days then 'due_soon'
    else 'valid'
  end as status,
  case
    when latest_gu.completed_on is null then null
    when coalesce(latest_ru.valid_until, latest_gu.valid_until) is null then null
    else (coalesce(latest_ru.valid_until, latest_gu.valid_until) - current_date)
  end as days_until_due
from active_members members
cross join public.competency_courses courses
left join latest_gu on latest_gu.member_id = members.member_id and latest_gu.course_id = courses.id
left join latest_ru on latest_ru.member_id = members.member_id and latest_ru.course_id = courses.id
where courses.active = true;

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
  where public.current_user_can_view_competency_reports()
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

grant execute on function public.competency_training_needs_window(date, date, uuid[], uuid[], uuid[], uuid[]) to authenticated;

alter table public.competency_user_permissions enable row level security;
alter table public.competency_departments enable row level security;
alter table public.competency_groups enable row level security;
alter table public.competency_group_managers enable row level security;
alter table public.competency_courses enable row level security;
alter table public.competency_members enable row level security;
alter table public.competency_training_events enable row level security;
alter table public.competency_notification_log enable row level security;

drop policy if exists "profiles_select_competency_admin" on public.profiles;
create policy "profiles_select_competency_admin"
  on public.profiles
  for select
  to authenticated
  using (public.current_user_can_manage_competency_permissions());

drop policy if exists "competency_permissions_select" on public.competency_user_permissions;
create policy "competency_permissions_select"
  on public.competency_user_permissions
  for select
  to authenticated
  using (user_id = auth.uid() or public.current_user_can_manage_competency_permissions());

drop policy if exists "competency_permissions_manage" on public.competency_user_permissions;
create policy "competency_permissions_manage"
  on public.competency_user_permissions
  for all
  to authenticated
  using (public.current_user_can_manage_competency_permissions())
  with check (public.current_user_can_manage_competency_permissions());

drop policy if exists "competency_departments_select" on public.competency_departments;
create policy "competency_departments_select"
  on public.competency_departments
  for select
  to authenticated
  using (public.current_user_can_access_competency());

drop policy if exists "competency_departments_manage" on public.competency_departments;
create policy "competency_departments_manage"
  on public.competency_departments
  for all
  to authenticated
  using (public.current_user_can_manage_competency_permissions())
  with check (public.current_user_can_manage_competency_permissions());

drop policy if exists "competency_groups_select" on public.competency_groups;
create policy "competency_groups_select"
  on public.competency_groups
  for select
  to authenticated
  using (public.current_user_can_access_competency());

drop policy if exists "competency_groups_manage" on public.competency_groups;
create policy "competency_groups_manage"
  on public.competency_groups
  for all
  to authenticated
  using (public.current_user_can_manage_competency_permissions())
  with check (public.current_user_can_manage_competency_permissions());

drop policy if exists "competency_group_managers_select" on public.competency_group_managers;
create policy "competency_group_managers_select"
  on public.competency_group_managers
  for select
  to authenticated
  using (public.current_user_can_access_competency());

drop policy if exists "competency_group_managers_manage" on public.competency_group_managers;
create policy "competency_group_managers_manage"
  on public.competency_group_managers
  for all
  to authenticated
  using (public.current_user_can_manage_competency_permissions())
  with check (public.current_user_can_manage_competency_permissions());

drop policy if exists "competency_courses_select" on public.competency_courses;
create policy "competency_courses_select"
  on public.competency_courses
  for select
  to authenticated
  using (public.current_user_can_access_competency());

drop policy if exists "competency_courses_manage" on public.competency_courses;
create policy "competency_courses_manage"
  on public.competency_courses
  for all
  to authenticated
  using (public.current_user_can_manage_competency_catalog())
  with check (public.current_user_can_manage_competency_catalog());

drop policy if exists "competency_members_select" on public.competency_members;
create policy "competency_members_select"
  on public.competency_members
  for select
  to authenticated
  using (public.current_user_can_access_competency() and archived_at is null);

drop policy if exists "competency_members_insert" on public.competency_members;
create policy "competency_members_insert"
  on public.competency_members
  for insert
  to authenticated
  with check (
    archived_at is null
    and public.current_user_can_access_competency()
    and public.current_user_can_manage_competency_group(group_id)
  );

drop policy if exists "competency_members_update" on public.competency_members;
create policy "competency_members_update"
  on public.competency_members
  for update
  to authenticated
  using (public.current_user_can_manage_competency_member(id))
  with check (public.current_user_can_manage_competency_group(group_id));

drop policy if exists "competency_members_delete" on public.competency_members;
create policy "competency_members_delete"
  on public.competency_members
  for delete
  to authenticated
  using (public.current_user_can_manage_competency_member(id));

drop policy if exists "competency_training_events_select" on public.competency_training_events;
create policy "competency_training_events_select"
  on public.competency_training_events
  for select
  to authenticated
  using (public.current_user_can_access_competency());

drop policy if exists "competency_training_events_insert" on public.competency_training_events;
create policy "competency_training_events_insert"
  on public.competency_training_events
  for insert
  to authenticated
  with check (
    public.current_user_can_access_competency()
    and public.current_user_can_manage_competency_member(member_id)
  );

drop policy if exists "competency_training_events_update" on public.competency_training_events;
create policy "competency_training_events_update"
  on public.competency_training_events
  for update
  to authenticated
  using (public.current_user_can_manage_competency_member(member_id))
  with check (public.current_user_can_manage_competency_member(member_id));

drop policy if exists "competency_training_events_delete" on public.competency_training_events;
create policy "competency_training_events_delete"
  on public.competency_training_events
  for delete
  to authenticated
  using (public.current_user_can_manage_competency_member(member_id));

drop policy if exists "competency_notification_log_select" on public.competency_notification_log;
create policy "competency_notification_log_select"
  on public.competency_notification_log
  for select
  to authenticated
  using (public.current_user_can_view_competency_reports());

drop policy if exists "competency_notification_log_insert_service" on public.competency_notification_log;
create policy "competency_notification_log_insert_service"
  on public.competency_notification_log
  for insert
  to authenticated
  with check (false);
