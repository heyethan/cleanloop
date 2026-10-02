/**
 * Service-level deadlines for a case: acknowledge within ack_hours, resolve within resolve_hours.
 *
 * Affected API: exports slaState(), median(). Used by the daily cron (overdue digest), the
 * performance page and the ops queue; checked in scripts/selfcheck.ts. Hours come from the
 * sla_config table (waste 24/72, road 72/720).
 * "Resolved" for SLA purposes = verified clean (awaiting confirmation or closed): the official's
 * job is done once the cleanup verifies, whether or not the reporter has answered yet.
 */
import type { ReportStatus } from "./types.ts";

interface SlaCase {
  created_at: string;
  acknowledged_at: string | null;
  verified_at: string | null;
  closed_at: string | null;
  status: ReportStatus;
}

export function slaState(r: SlaCase, cfg: { ack_hours: number; resolve_hours: number }, now = Date.now()) {
  const created = Date.parse(r.created_at);
  const ackDue = created + cfg.ack_hours * 3_600_000;
  const resolveDue = created + cfg.resolve_hours * 3_600_000;
  const done = r.status === "awaiting_confirmation" || r.status === "verified_resolved";
  return {
    ackDue: new Date(ackDue).toISOString(),
    resolveDue: new Date(resolveDue).toISOString(),
    ackOverdue: !r.acknowledged_at && !done && now > ackDue,
    resolveOverdue: !done && now > resolveDue,
  };
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
