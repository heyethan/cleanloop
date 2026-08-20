-- CleanLoop schema v2 — real-data layer.
--
-- Importers/callers: applied by scripts/apply-schema-v2.ts via the Supabase
-- Management API query endpoint; read by src/app/api/facilities/route.ts and
-- written by scripts/seed.ts.
-- Affected API: adds the waste_facilities table and photo-provenance columns on
-- reports and resolutions.
-- Data schemas: waste_facilities {id text "node/123", amenity text, lat/lng float,
-- name, operator, ward_id, source, imported_at timestamptz ISO-8601}. Added columns
-- photo_attribution/photo_license/photo_source_url are text; is_genuine_pair boolean.
-- User instruction, verbatim: "I want actual data to be populated in as many areas as possible"

-- Real civic waste infrastructure from OpenStreetMap (bins, recycling, disposal points).
-- This is GENUINE data, not seeded: 574 nodes across Bengaluru at time of import.
create table if not exists waste_facilities (
  id text primary key,              -- "node/123456789" from OSM
  amenity text not null,            -- waste_basket | recycling | waste_disposal
  lat double precision not null,
  lng double precision not null,
  name text,
  operator text,
  ward_id text,
  source text not null default 'openstreetmap',
  imported_at timestamptz not null default now()
);

create index if not exists facilities_geo_idx on waste_facilities (lat, lng);
create index if not exists facilities_amenity_idx on waste_facilities (amenity);

alter table waste_facilities enable row level security;
drop policy if exists "public read facilities" on waste_facilities;
create policy "public read facilities" on waste_facilities for select using (true);

-- Photo provenance. Seeded photos are real Creative Commons images from Wikimedia
-- Commons and MUST carry attribution wherever displayed.
alter table reports add column if not exists photo_attribution text;
alter table reports add column if not exists photo_license text;
alter table reports add column if not exists photo_source_url text;

alter table resolutions add column if not exists photo_attribution text;
alter table resolutions add column if not exists photo_license text;
alter table resolutions add column if not exists photo_source_url text;

-- HONESTY FLAG: seeded before/after pairs use two real CC photos that are NOT
-- photographs of the same location. Any pair with this false must never be
-- presented as evidence of a real verified cleanup.
alter table resolutions add column if not exists is_genuine_pair boolean not null default false;
