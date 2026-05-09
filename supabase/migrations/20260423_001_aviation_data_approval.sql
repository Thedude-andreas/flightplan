create table if not exists public.aviation_data_updates (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'failed')),
  storage_bucket text not null,
  candidate_prefix text not null,
  current_prefix text not null default 'current',
  files text[] not null default '{}',
  changed_files text[] not null default '{}',
  report_markdown text not null,
  preview_url text,
  approve_token_hash text not null,
  reject_token_hash text not null,
  source jsonb not null default '{}'::jsonb,
  error_message text,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists aviation_data_updates_status_created_idx
  on public.aviation_data_updates (status, created_at desc);

drop trigger if exists set_aviation_data_updates_updated_at on public.aviation_data_updates;
create trigger set_aviation_data_updates_updated_at
  before update on public.aviation_data_updates
  for each row execute procedure public.set_updated_at();

alter table public.aviation_data_updates enable row level security;

drop policy if exists "aviation_data_updates_service_role_only" on public.aviation_data_updates;
create policy "aviation_data_updates_service_role_only"
  on public.aviation_data_updates
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'aviation-data',
  'aviation-data',
  true,
  52428800,
  array['application/json']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "aviation_data_public_read" on storage.objects;
create policy "aviation_data_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'aviation-data');

drop policy if exists "aviation_data_service_role_write" on storage.objects;
create policy "aviation_data_service_role_write"
  on storage.objects
  for all
  using (bucket_id = 'aviation-data' and auth.role() = 'service_role')
  with check (bucket_id = 'aviation-data' and auth.role() = 'service_role');
