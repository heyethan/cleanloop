/**
 * The case lifecycle as a small state machine.
 *
 * Affected API: exports EventKind, nextStatus(). Used by src/lib/events.ts (the only writer of
 * status changes) and scripts/selfcheck.ts.
 *
 * reports.status stays four values so the map/list colours keep working; everything finer
 * (sent, acknowledged, ETA...) is a timeline event that leaves the status alone. A verified
 * cleanup waits for the reporter before it counts as resolved.
 */
import type { ReportStatus } from "./types.ts";

export type EventKind =
  | "received"
  | "sent"
  | "acknowledged"
  | "assigned"
  | "eta_set"
  | "escalated"
  | "claimed"
  | "verified"
  | "confirmed"
  | "auto_closed"
  | "disputed"
  | "reopened";

/** Events that only add to the timeline. Allowed while the case is still live. */
const TIMELINE_ONLY = new Set<EventKind>(["received", "sent", "acknowledged", "assigned", "eta_set", "escalated"]);

const MOVES: Partial<Record<EventKind, { from: ReportStatus[]; to: ReportStatus }>> = {
  claimed: { from: ["open", "claimed"], to: "claimed" },
  verified: { from: ["open", "claimed"], to: "awaiting_confirmation" },
  confirmed: { from: ["awaiting_confirmation"], to: "verified_resolved" },
  auto_closed: { from: ["awaiting_confirmation"], to: "verified_resolved" },
  disputed: { from: ["awaiting_confirmation"], to: "open" },
  reopened: { from: ["verified_resolved"], to: "open" },
};

/** The status after `kind` happens in `status`, or null if that event can't happen now. */
export function nextStatus(status: ReportStatus, kind: EventKind): ReportStatus | null {
  if (TIMELINE_ONLY.has(kind)) return status === "verified_resolved" ? null : status;
  const move = MOVES[kind];
  return move && move.from.includes(status) ? move.to : null;
}
