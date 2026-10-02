/**
 * The one place a case's status or timeline changes.
 *
 * Affected API: exports transition(). Used by the report, resolve, confirm, act and cron routes.
 * Writes reports (status + lifecycle columns) and appends report_events. Server-only (service role).
 * ponytail: read-then-write, not a single transaction; two simultaneous actions on one case can
 * both pass the check. Fine at civic-report volume; move into a Postgres function if that changes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextStatus, type EventKind } from "./lifecycle.ts";
import type { ReportStatus, ReportEvent } from "./types.ts";

export class TransitionError extends Error {}

export async function transition(
  db: SupabaseClient,
  reportId: string,
  kind: EventKind,
  actor: ReportEvent["actor"],
  opts: { data?: Record<string, unknown>; patch?: Record<string, unknown> } = {},
): Promise<ReportStatus> {
  const { data: row, error } = await db.from("reports").select("status, reopen_count").eq("id", reportId).single();
  if (error || !row) throw new TransitionError("report not found");
  const to = nextStatus(row.status as ReportStatus, kind);
  if (!to) throw new TransitionError(`That can't happen to a case that is ${String(row.status).replaceAll("_", " ")} (${kind}).`);

  const now = new Date().toISOString();
  const stamp: Record<string, unknown> = {
    sent: { sent_at: now },
    acknowledged: { acknowledged_at: now },
    confirmed: { closed_at: now },
    auto_closed: { closed_at: now },
    disputed: { reopen_count: (row.reopen_count ?? 0) + 1, confirm_due_at: null, verified_at: null },
    reopened: { reopen_count: (row.reopen_count ?? 0) + 1, closed_at: null },
  }[kind as string] ?? {};

  const { error: upErr } = await db
    .from("reports")
    .update({ status: to, ...stamp, ...opts.patch })
    .eq("id", reportId);
  if (upErr) throw new Error(upErr.message);
  const { error: evErr } = await db
    .from("report_events")
    .insert({ report_id: reportId, kind, actor, data: opts.data ?? {} });
  if (evErr) throw new Error(evErr.message);
  return to;
}
