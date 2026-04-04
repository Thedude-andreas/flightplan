create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aircraft_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  registration text not null,
  type_name text not null,
  visibility text not null default 'private' check (visibility in ('private', 'shared', 'public')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.flight_plans (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  aircraft_profile_id uuid references public.aircraft_profiles(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  visibility text not null default 'private' check (visibility in ('private', 'shared', 'public')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.shared_access (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('flight_plan', 'aircraft_profile')),
  resource_id uuid not null,
  grantee_user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now()
);

create index if not exists aircraft_profiles_owner_updated_idx
  on public.aircraft_profiles (owner_user_id, updated_at desc)
  where archived_at is null;

create index if not exists flight_plans_owner_updated_idx
  on public.flight_plans (owner_user_id, updated_at desc)
  where archived_at is null;

create unique index if not exists shared_access_unique_grant_idx
  on public.shared_access (resource_type, resource_id, grantee_user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_aircraft_profiles_updated_at on public.aircraft_profiles;
create trigger set_aircraft_profiles_updated_at
  before update on public.aircraft_profiles
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_flight_plans_updated_at on public.flight_plans;
create trigger set_flight_plans_updated_at
  before update on public.flight_plans
  for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.aircraft_profiles enable row level security;
alter table public.flight_plans enable row level security;
alter table public.shared_access enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "aircraft_profiles_select_own" on public.aircraft_profiles;
create policy "aircraft_profiles_select_own"
  on public.aircraft_profiles
  for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "aircraft_profiles_insert_own" on public.aircraft_profiles;
create policy "aircraft_profiles_insert_own"
  on public.aircraft_profiles
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists "aircraft_profiles_update_own" on public.aircraft_profiles;
create policy "aircraft_profiles_update_own"
  on public.aircraft_profiles
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "aircraft_profiles_delete_own" on public.aircraft_profiles;
create policy "aircraft_profiles_delete_own"
  on public.aircraft_profiles
  for delete
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "flight_plans_select_own" on public.flight_plans;
create policy "flight_plans_select_own"
  on public.flight_plans
  for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "flight_plans_insert_own" on public.flight_plans;
create policy "flight_plans_insert_own"
  on public.flight_plans
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists "flight_plans_update_own" on public.flight_plans;
create policy "flight_plans_update_own"
  on public.flight_plans
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "flight_plans_delete_own" on public.flight_plans;
create policy "flight_plans_delete_own"
  on public.flight_plans
  for delete
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "shared_access_select_own_grants" on public.shared_access;
create policy "shared_access_select_own_grants"
  on public.shared_access
  for select
  to authenticated
  using (grantee_user_id = auth.uid());

drop policy if exists "shared_access_manage_owned_resources" on public.shared_access;
create policy "shared_access_manage_owned_resources"
  on public.shared_access
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.flight_plans fp
      where shared_access.resource_type = 'flight_plan'
        and shared_access.resource_id = fp.id
        and fp.owner_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.aircraft_profiles ap
      where shared_access.resource_type = 'aircraft_profile'
        and shared_access.resource_id = ap.id
        and ap.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.flight_plans fp
      where shared_access.resource_type = 'flight_plan'
        and shared_access.resource_id = fp.id
        and fp.owner_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.aircraft_profiles ap
      where shared_access.resource_type = 'aircraft_profile'
        and shared_access.resource_id = ap.id
        and ap.owner_user_id = auth.uid()
    )
  );
