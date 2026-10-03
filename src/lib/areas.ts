/**
 * Open/overdue counts per GBA ward, zone and corporation, and the officials island built on them.
 *
 * Importers/callers: src/app/api/areas/route.ts, src/app/api/officials-summary/route.ts,
 * src/app/api/reports/route.ts (per-pin overdue flag); checked in scripts/selfcheck.ts.
 * Affected API: exports CaseRow, SlaCfg, isOverdue(), countAreas(), officialsSummary().
 * Data schemas: CaseRow is a subset of `reports` columns; timestamps ISO-8601.
 *
 * Pure: no Supabase import (selfcheck runs this under node strip-types). The overdue rule is the
 * one /performance uses (src/lib/performance.ts), so the island and that page always agree:
 * our own cases only, with a corporation, not "[test]", open or held, past the category deadline.
 */
import { slaState } from "./sla.ts";
import { pickOfficial, type Official } from "./officials.ts";
import type { ReportStatus } from "./types.ts";

export interface CaseRow {
  created_at: string;
  acknowledged_at: string | null;
  verified_at: string | null;
  closed_at: string | null;
  status: ReportStatus;
  category: "waste" | "road" | null;
  source: string | null;
  description: string | null;
  gba_ward_id: string | null;
  zone: string | null;
  corporation: string | null;
}

export type SlaCfg = Record<string, { ack_hours: number; resolve_hours: number }>;

export interface Count {
  open: number;
  overdue: number;
}

/** Counted at all: our own live-tracked cases. Imports and QA rows never are. */
function counted(r: CaseRow): boolean {
  return r.source === "cleanloop" && !!r.corporation && !r.description?.startsWith("[test]");
}

const live = (r: CaseRow) => r.status === "open" || r.status === "claimed";

export function isOverdue(r: CaseRow, cfg: SlaCfg, now = Date.now()): boolean {
  return counted(r) && live(r) && slaState(r, cfg[r.category ?? "waste"] ?? cfg.waste, now).resolveOverdue;
}

/** Counts keyed "ward:<id>", "zone:<name>", "corp:<name>" and "city". */
export function countAreas(rows: CaseRow[], cfg: SlaCfg, now = Date.now()): Map<string, Count> {
  const out = new Map<string, Count>();
  const bump = (k: string, overdue: boolean) => {
    const c = out.get(k) ?? { open: 0, overdue: 0 };
    c.open++;
    if (overdue) c.overdue++;
    out.set(k, c);
  };
  for (const r of rows) {
    if (!counted(r) || !live(r)) continue;
    const o = isOverdue(r, cfg, now);
    bump("city", o);
    bump(`corp:${r.corporation}`, o);
    if (r.zone) bump(`zone:${r.zone}`, o);
    if (r.gba_ward_id) bump(`ward:${r.gba_ward_id}`, o);
  }
  return out;
}

export interface IslandOfficial {
  name: string;
  role: string;
  photo_url: string | null;
  level: "city" | "corporation" | "zone";
  /** What they answer for: a zone name, a corporation name, or "Bengaluru". */
  area: string;
  /** Zone names covered — the map frames these on click. */
  zones: string[];
  open: number;
  overdue: number;
}

/**
 * One face per area: the city head, each corporation commissioner, each zonal commissioner.
 * pickOfficial's own escalation picks who; a zone with no named official is skipped rather than
 * shown under someone else's face. Sorted by overdue, then open.
 */
export function officialsSummary(
  officials: Official[],
  counts: Map<string, Count>,
  zonesByCorp: Record<string, string[]>,
): IslandOfficial[] {
  const out: IslandOfficial[] = [];
  const add = (o: Official | null, level: IslandOfficial["level"], area: string, zones: string[], key: string) => {
    if (!o?.name || o.level !== level) return;
    const c = counts.get(key) ?? { open: 0, overdue: 0 };
    out.push({ name: o.name, role: o.role, photo_url: o.photo_url, level, area, zones, ...c });
  };
  const allZones = Object.values(zonesByCorp).flat();
  add(pickOfficial(officials, { id: "", zone_name: "", corporation: "" }, "waste"), "city", "Bengaluru", allZones, "city");
  for (const [corp, zones] of Object.entries(zonesByCorp)) {
    add(pickOfficial(officials.filter((o) => o.level !== "zone"), { id: "", zone_name: "", corporation: corp }, "waste"), "corporation", `${corp} corporation`, zones, `corp:${corp}`);
    for (const zone of zones) add(pickOfficial(officials, { id: "", zone_name: zone, corporation: corp }, "waste"), "zone", zone, [zone], `zone:${zone}`);
  }
  return out.sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}
