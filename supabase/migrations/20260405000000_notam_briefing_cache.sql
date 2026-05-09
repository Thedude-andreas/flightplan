create table if not exists public.notam_briefing_cache (
  briefing_key text primary key,
  source_url text not null,
  fetched_at timestamptz not null default now(),
  bulletin_published_at timestamptz,
  sections jsonb not null default '{}'::jsonb
);

alter table public.notam_briefing_cache enable row level security;
