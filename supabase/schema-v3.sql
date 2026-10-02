-- CleanLoop schema v3: case lifecycle, accountability, roads, imports.
-- Applied with `npm run sql -- supabase/schema-v3.sql` (scripts/apply-sql.ts). Idempotent:
-- running it twice is the migration check. Timestamps are timestamptz (ISO-8601 over the API).
-- Status stays four values; the finer lifecycle lives in report_events (src/lib/lifecycle.ts).

-- ---------- reports: status ----------
alter table reports drop constraint if exists reports_status_check;
alter table reports add constraint reports_status_check
  check (status in ('open','claimed','awaiting_confirmation','verified_resolved'));

-- ---------- reports: category (waste | road) ----------
alter table reports add column if not exists category text not null default 'waste';
alter table reports drop constraint if exists reports_category_check;
alter table reports add constraint reports_category_check check (category in ('waste','road'));
alter table reports alter column waste_type drop not null;
alter table reports add column if not exists road_issue text;
alter table reports drop constraint if exists reports_road_issue_check;
alter table reports add constraint reports_road_issue_check
  check (road_issue is null or road_issue in ('pothole','damaged_surface','waterlogging','debris'));
alter table reports add column if not exists road_segment_id text;

-- ---------- reports: GBA wards (369) ----------
alter table reports add column if not exists corporation text;
alter table reports add column if not exists zone text;
alter table reports add column if not exists legacy_ward_id text;

-- ---------- reports: lifecycle timestamps (copied from events for SLA queries) ----------
alter table reports add column if not exists sent_at timestamptz;
alter table reports add column if not exists acknowledged_at timestamptz;
alter table reports add column if not exists assigned_to text;
alter table reports add column if not exists eta_at timestamptz;
alter table reports add column if not exists verified_at timestamptz;
alter table reports add column if not exists confirm_due_at timestamptz;
alter table reports add column if not exists closed_at timestamptz;
alter table reports add column if not exists reopen_count int not null default 0;

-- ---------- reports: anonymous reporter + capture provenance ----------
alter table reports add column if not exists tracking_code_hash text;
create unique index if not exists reports_tracking_code_uidx on reports (tracking_code_hash)
  where tracking_code_hash is not null;
alter table reports add column if not exists description text;
alter table reports add column if not exists location_accuracy_m real;
alter table reports add column if not exists photo_taken_at timestamptz;
alter table reports add column if not exists capture_mode text;
alter table resolutions add column if not exists location_accuracy_m real;

-- ---------- reports: import provenance ----------
alter table reports add column if not exists source text not null default 'cleanloop';
alter table reports add column if not exists source_id text;
alter table reports add column if not exists source_attribution text;
alter table reports add column if not exists source_url text;
alter table reports add column if not exists is_public boolean not null default true;
create unique index if not exists reports_source_uidx on reports (source, source_id)
  where source_id is not null;
create index if not exists reports_ward_idx on reports (ward_id);
create index if not exists reports_corporation_idx on reports (corporation);

-- ---------- timeline ----------
create table if not exists report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references reports(id) on delete cascade,
  kind text not null check (kind in ('received','sent','acknowledged','assigned','eta_set',
    'escalated','claimed','verified','confirmed','auto_closed','disputed','reopened')),
  actor text not null check (actor in ('system','reporter','official','operator')),
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists report_events_report_idx on report_events (report_id, created_at);

-- ---------- responsible officials (ward -> zone -> corporation -> city) ----------
create table if not exists officials (
  id bigint generated always as identity primary key,
  level text not null check (level in ('ward','zone','corporation','city')),
  ward_id text,
  zone text,
  corporation text,
  category text not null check (category in ('waste','road','all')),
  role text not null,
  name text,
  photo_url text,
  email text,
  source_url text,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists officials_lookup_idx on officials (level, category, ward_id, zone, corporation);

-- ---------- SLA config ----------
create table if not exists sla_config (
  category text primary key,
  ack_hours int not null,
  resolve_hours int not null,
  confirm_days int not null default 3
);
insert into sla_config (category, ack_hours, resolve_hours, confirm_days) values
  ('waste', 24, 72, 3), ('road', 72, 720, 3)
on conflict (category) do nothing;

-- ---------- outbound email audit (never public) ----------
create table if not exists email_log (
  id bigint generated always as identity primary key,
  dedupe_key text unique not null,
  to_addr text,
  subject text,
  provider_id text,
  error text,
  sent_at timestamptz not null default now()
);

-- ---------- RLS: public read where the map needs it; email_log has no policy at all ----------
alter table report_events enable row level security;
alter table officials enable row level security;
alter table sla_config enable row level security;
alter table email_log enable row level security;
drop policy if exists "public read report_events" on report_events;
create policy "public read report_events" on report_events for select using (true);
drop policy if exists "public read officials" on officials;
create policy "public read officials" on officials for select using (true);
drop policy if exists "public read sla_config" on sla_config;
create policy "public read sla_config" on sla_config for select using (true);

-- ---------- backfill (each guarded, so re-runs add nothing) ----------
insert into report_events (report_id, kind, actor, created_at)
select r.id, 'received', 'system', r.created_at from reports r
where not exists (select 1 from report_events e where e.report_id = r.id and e.kind = 'received');

insert into report_events (report_id, kind, actor, data, created_at)
select s.report_id, 'verified', 'system', jsonb_build_object('backfill', true), s.verified_at
from resolutions s
where s.ai_verification_result = 'verified_clean' and s.verified_at is not null
  and not exists (select 1 from report_events e where e.report_id = s.report_id and e.kind = 'verified');

-- Cases closed before confirmation existed stay closed: give them verified_at/closed_at so they
-- never enter the confirmation window.
update reports r set
  verified_at = coalesce(r.verified_at, (select min(s.verified_at) from resolutions s
                 where s.report_id = r.id and s.ai_verification_result = 'verified_clean')),
  closed_at = coalesce(r.closed_at, (select min(s.verified_at) from resolutions s
                 where s.report_id = r.id and s.ai_verification_result = 'verified_clean'), r.created_at)
where r.status = 'verified_resolved' and r.closed_at is null;
