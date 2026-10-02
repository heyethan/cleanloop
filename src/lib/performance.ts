/**
 * Public accountability numbers by corporation and zone, with the named official for each.
 *
 * Affected API: exports Perf, performance(). Used by /performance and GET /api/performance.
 * Reads reports (public columns), report_events, officials, sla_config with the service role.
 * Metrics (the five on the dashboard): open overdue, median days to acknowledge, median days to
 * verified, reopen rate, confirmation rate. Seeded demo cases ARE included in the totals so the
 * page isn't empty, and the demo share is reported alongside so nobody mistakes it for live data.
 * Imports and "[test]" rows are excluded.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAll } from "./supabase.ts";
import { median, slaState } from "./sla.ts";
import type { Official } from "./officials.ts";

const DAY = 86_400_000;

export interface Perf {
  name: string;
  official: Pick<Official, "name" | "role" | "photo_url" | "source_url"> | null;
  total: number;
  demo: number;
  open: number;
  overdue: number;
  medianDaysToAck: number | null;
  medianDaysToVerified: number | null;
  reopenRate: number | null;
  confirmationRate: number | null;
}

interface Row {
  id: string;
  created_at: string;
  acknowledged_at: string | null;
  verified_at: string | null;
  closed_at: string | null;
  status: "open" | "claimed" | "awaiting_confirmation" | "verified_resolved";
  category: "waste" | "road" | null;
  corporation: string | null;
  zone: string | null;
  reopen_count: number | null;
  is_seed: boolean;
}

function summarise(name: string, rows: Row[], closes: Map<string, string>, cfg: Record<string, { ack_hours: number; resolve_hours: number }>, official: Perf["official"], now: number): Perf {
  const live = rows.filter((r) => r.status === "open" || r.status === "claimed");
  const days = (a: string | null, b: string) => (a ? (Date.parse(a) - Date.parse(b)) / DAY : null);
  const ack = rows.map((r) => days(r.acknowledged_at, r.created_at)).filter((x): x is number => x !== null);
  const ver = rows.map((r) => days(r.verified_at, r.created_at)).filter((x): x is number => x !== null);
  const outcomes = rows.map((r) => closes.get(r.id)).filter(Boolean);
  const confirmed = outcomes.filter((k) => k === "confirmed").length;
  return {
    name,
    official,
    total: rows.length,
    demo: rows.filter((r) => r.is_seed).length,
    open: live.length,
    overdue: live.filter((r) => slaState(r, cfg[r.category ?? "waste"] ?? cfg.waste, now).resolveOverdue).length,
    medianDaysToAck: median(ack),
    medianDaysToVerified: median(ver),
    reopenRate: rows.length ? rows.filter((r) => (r.reopen_count ?? 0) > 0).length / rows.length : null,
    confirmationRate: outcomes.length ? confirmed / outcomes.length : null,
  };
}

export async function performance(db: SupabaseClient, now = Date.now()) {
  const [rows, events, { data: officials }, { data: cfgRows }] = await Promise.all([
    selectAll((from, to) =>
      db
        .from("reports")
        .select("id, created_at, acknowledged_at, verified_at, closed_at, status, category, corporation, zone, reopen_count, is_seed, description, source")
        .eq("source", "cleanloop")
        .order("id")
        .range(from, to),
    ),
    // Ordered by time so the LAST outcome per case wins (a case can be disputed, then confirmed).
    selectAll((from, to) =>
      db.from("report_events").select("report_id, kind, created_at").in("kind", ["confirmed", "auto_closed", "disputed"]).order("created_at").order("id").range(from, to),
    ),
    db.from("officials").select("*").order("id"),
    db.from("sla_config").select("*"),
  ]);
  const cases = ((rows ?? []) as (Row & { description: string | null })[]).filter(
    (r) => r.corporation && !r.description?.startsWith("[test]"),
  );
  // Latest confirmation outcome per case.
  const closes = new Map<string, string>();
  for (const e of events ?? []) closes.set(e.report_id, e.kind);
  const cfg = Object.fromEntries((cfgRows ?? []).map((c) => [c.category, c]));
  const offs = (officials ?? []) as Official[];
  const pick = (o: Official | undefined) => (o ? { name: o.name, role: o.role, photo_url: o.photo_url, source_url: o.source_url } : null);

  const corporations = [...new Set(cases.map((r) => r.corporation!))].sort().map((corp) => {
    const inCorp = cases.filter((r) => r.corporation === corp);
    const zones = [...new Set(inCorp.map((r) => r.zone!).filter(Boolean))].sort().map((zone) =>
      summarise(zone, inCorp.filter((r) => r.zone === zone), closes, cfg, pick(offs.find((o) => o.level === "zone" && o.zone === zone && o.name)), now),
    );
    return {
      ...summarise(corp, inCorp, closes, cfg, pick(offs.find((o) => o.level === "corporation" && o.corporation === corp && o.category === "all")), now),
      zones,
    };
  });
  return { city: summarise("Bengaluru", cases, closes, cfg, pick(offs.find((o) => o.level === "city" && o.category === "all")), now), corporations };
}
