/**
 * Durable verification — did a cleanup actually last?
 *
 * Importers/callers: src/app/api/stats/route.ts.
 * Affected API: exports refilledAfterVerification(), integrityStats(), and their types.
 * Data schemas: none written. Pure functions over Report[] and Resolution[] already held
 * in memory by the caller. Reads `verified_at` / `created_at` (ISO-8601 strings, compared
 * lexicographically, which is valid for ISO-8601 in UTC).
 *
 * WHY THIS EXISTS
 *
 * Every civic waste app can tell you a case was closed. The national incumbent closes cases
 * on a photo uploaded by whoever did the work, which is why its reviews describe blank
 * images accepted as proof. CleanLoop already separates those roles — the claimant never
 * certifies their own cleanup. This extends that across time: a spot that was verified clean
 * and then refilled was not really resolved, and saying so is the only honest way to report
 * a resolution rate.
 *
 * Deliberately a measurement, not a prediction. Predicting where dumping will happen is a
 * crowded field; auditing our own closures is not, and it needs no model.
 */

import { haversineMetres } from "./wards";
import { RECURRING_RADIUS_METRES } from "./supabase";
import type { Report, Resolution } from "./types";

export interface RefilledSpot {
  report_id: string;
  ward_id: string | null;
  /** Whole days between the verification and the first report that reappeared nearby. */
  days_held: number;
}

export interface DurabilityStats {
  /** Verified-clean spots being watched. */
  watched: number;
  /** Of those, how many had waste reported again inside the radius. */
  refilled: number;
  items: RefilledSpot[];
}

/**
 * Earliest verification per report.
 *
 * A report can accumulate several attempts — a yellow "claimed" pass before a green one —
 * and only the first green counts. Same rule as src/app/api/leaderboard/route.ts; the two
 * must not disagree about when a case closed.
 */
function firstVerifiedAt(resolutions: Resolution[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const r of resolutions) {
    if (!r.verified_at) continue;
    const prev = first.get(r.report_id);
    if (!prev || r.verified_at < prev) first.set(r.report_id, r.verified_at);
  }
  return first;
}

export function refilledAfterVerification(
  reports: Report[],
  resolutions: Resolution[],
  radiusMetres = RECURRING_RADIUS_METRES,
): DurabilityStats {
  const verifiedAtOf = firstVerifiedAt(resolutions);
  const items: RefilledSpot[] = [];
  let watched = 0;

  for (const spot of reports) {
    const verifiedAt = verifiedAtOf.get(spot.id);
    if (!verifiedAt) continue;
    watched++;

    /*
     * The EARLIEST later report inside the radius, not merely any of them — "how long did it
     * hold" is only meaningful against the first thing that broke it.
     */
    let firstRefill: Report | null = null;
    for (const other of reports) {
      if (other.id === spot.id) continue;
      if (other.created_at <= verifiedAt) continue;
      if (haversineMetres(spot.lat, spot.lng, other.lat, other.lng) > radiusMetres) continue;
      if (!firstRefill || other.created_at < firstRefill.created_at) firstRefill = other;
    }
    if (!firstRefill) continue;

    const ms = new Date(firstRefill.created_at).getTime() - new Date(verifiedAt).getTime();
    items.push({
      report_id: spot.id,
      ward_id: spot.ward_id,
      days_held: Math.max(0, Math.round(ms / 86_400_000)),
    });
  }

  items.sort((a, b) => a.days_held - b.days_held);
  return { watched, refilled: items.length, items };
}

export interface IntegrityStats {
  /** Cleanup claims submitted. */
  claims_total: number;
  /** Claims that did not pass verification. */
  claims_rejected: number;
  /** 0-1, or null when nothing has been claimed yet. */
  rejection_rate: number | null;
}

/**
 * The number no incumbent can publish, because none of them check.
 *
 * Counts every claim whose verdict was not `verified_clean` — the model either found the
 * waste still present, or could not establish that both photos show the same place.
 */
export function integrityStats(resolutions: Resolution[]): IntegrityStats {
  const total = resolutions.length;
  const rejected = resolutions.filter((r) => r.ai_verification_result !== "verified_clean").length;
  return {
    claims_total: total,
    claims_rejected: rejected,
    rejection_rate: total > 0 ? rejected / total : null,
  };
}
