create table if not exists public.weather_briefing_cache (
  briefing_key text primary key,
  fetched_at timestamptz not null default now(),
  sections jsonb not null default '{}'::jsonb
);

alter table public.weather_briefing_cache enable row level security;
