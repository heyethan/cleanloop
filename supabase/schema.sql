-- CleanLoop schema — Supabase project easrgnsidtazgphcybsi (ap-south-1)
-- Applied via the Management API query endpoint by scripts/apply-schema.sh
-- ponytail: no PostGIS. Recurring detection is a lat/lng bounding-box query (spec §7 fallback).

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  photo_before_url text not null,
  lat double precision not null,
  lng double precision not null,
  ward_id text,
  waste_type text not null check (waste_type in ('mixed','plastic','organic','construction','hazardous','other')),
  severity int not null check (severity between 1 and 5),
  is_recurring boolean not null default false,
  recurring_of_report_id uuid references reports(id),
  status text not null default 'open' check (status in ('open','claimed','verified_resolved')),
  complaint_text text,
  ai_description text,
  ai_confidence double precision,
  created_at timestamptz not null default now(),
  reporter_session_id text,
  is_seed boolean not null default false
);

create index if not exists reports_geo_idx on reports (lat, lng);
create index if not exists reports_created_idx on reports (created_at desc);
create index if not exists reports_status_idx on reports (status);

create table if not exists resolutions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  photo_after_url text not null,
  ai_verification_result text not null check (ai_verification_result in ('verified_clean','ambiguous','not_clean')),
  ai_confidence double precision not null,
  ai_reasoning text,
  submitted_at timestamptz not null default now(),
  verified_at timestamptz,
  resolver_session_id text,
  -- spec §3 Flow B, chosen option: anyone may resolve, but self-resolution is flagged for traceability
  is_self_resolved boolean not null default false
);

create index if not exists resolutions_report_idx on resolutions (report_id);

create table if not exists wards (
  id text primary key,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  representative_name text,
  representative_role text
);

-- Public read; all writes go through service-role API routes only.
alter table reports enable row level security;
alter table resolutions enable row level security;
alter table wards enable row level security;

drop policy if exists "public read reports" on reports;
create policy "public read reports" on reports for select using (true);
drop policy if exists "public read resolutions" on resolutions;
create policy "public read resolutions" on resolutions for select using (true);
drop policy if exists "public read wards" on wards;
create policy "public read wards" on wards for select using (true);

-- Public storage bucket for before/after photos.
insert into storage.buckets (id, name, public)
values ('cleanloop', 'cleanloop', true)
on conflict (id) do nothing;
