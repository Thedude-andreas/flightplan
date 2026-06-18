create table if not exists public.smart_route_import_logs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('text', 'spreadsheet', 'pdf', 'image', 'file')),
  file_name text,
  file_type text,
  file_size_bytes bigint,
  model text,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  success boolean not null default false,
  confidence numeric(4, 3),
  waypoint_count integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists smart_route_import_logs_owner_created_idx
  on public.smart_route_import_logs (owner_user_id, created_at desc);

alter table public.smart_route_import_logs enable row level security;

drop policy if exists "smart_route_import_logs_select_own" on public.smart_route_import_logs;
create policy "smart_route_import_logs_select_own"
  on public.smart_route_import_logs
  for select
  to authenticated
  using (owner_user_id = auth.uid());
