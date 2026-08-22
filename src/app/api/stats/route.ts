/**
 * GET /api/stats — headline numbers for the header card.
 *
 * Importers/callers: called over HTTP by src/components/StatBar.tsx.
 * Affected API: this route's own HTTP contract (GET, returns counts JSON).
 * Data schemas: reads reports, resolutions, waste_facilities. Returns counts and a
 * median days-to-verified. No timestamps returned, only day counts.
 * User instruction, verbatim: "I want actual data to be populated in as many areas as possible"
 *
 * UX note (Social Proof / Anchoring): the FIRST number a visitor sees must be
 * verified cleanups, not complaints filed. Complaint volume proves nothing —
 * proving the loop closes is the entire pitch.
 */

import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { integrityStats, refilledAfterVerification } from "@/lib/durability";
import type { Report, Resolution } from "@/lib/types";

export async function GET() {
  try {
    const db = serverClient();

    const [reports, resolutions, facilities] = await Promise.all([
      // lat/lng/ward_id are needed for the durability check below, which asks whether a
      // verified spot later had waste reported within 50m of it.
      db.from("reports").select("id,status,created_at,is_seed,lat,lng,ward_id"),
      // Deliberately NOT filtered to verified_at — the integrity number counts the claims
      // that FAILED, and a failed claim never gets a verified_at.
      db.from("resolutions").select("report_id,verified_at,ai_verification_result"),
      db.from("waste_facilities").select("id", { count: "exact", head: true }),
    ]);

    if (reports.error) throw new Error(reports.error.message);
    if (resolutions.error) throw new Error(resolutions.error.message);

    const rows = reports.data ?? [];
    const verifiedRows = resolutions.data ?? [];

    const firstVerified = new Map<string, string>();
    for (const r of verifiedRows) {
      // The query no longer pre-filters these, so unverified attempts arrive here too.
      if (!r.verified_at) continue;
      const prev = firstVerified.get(r.report_id as string);
      const at = r.verified_at as string;
      if (!prev || at < prev) firstVerified.set(r.report_id as string, at);
    }

    const durations: number[] = [];
    for (const rep of rows) {
      const v = firstVerified.get(rep.id as string);
      if (!v) continue;
      const d =
        (new Date(v).getTime() - new Date(rep.created_at as string).getTime()) /
        86_400_000;
      if (d >= 0) durations.push(d);
    }
    durations.sort((a, b) => a - b);
    const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;

    const open = rows.filter((r) => r.status === "open").length;
    const claimed = rows.filter((r) => r.status === "claimed").length;
    const verified = rows.filter((r) => r.status === "verified_resolved").length;

    /*
     * The two numbers no incumbent can publish. Both are measured from rows we already
     * fetched, so this adds no query and no model call.
     */
    /*
     * Which ward has the most REJECTED claims. The evidence pack's hero section is the
     * rejection log, and rejections run only ~1-2 per ward, so an entry link chosen by
     * report count would routinely land on a ward whose hero is empty. Pick by the number
     * that actually has to be non-zero.
     */
    const wardOf = new Map(rows.map((r) => [r.id as string, r.ward_id as string | null]));
    const rejectionsByWard = new Map<string, number>();
    for (const r of verifiedRows) {
      if (r.ai_verification_result === "verified_clean") continue;
      const w = wardOf.get(r.report_id as string);
      if (!w) continue;
      rejectionsByWard.set(w, (rejectionsByWard.get(w) ?? 0) + 1);
    }
    let topRejectionWard: string | null = null;
    let topRejectionCount = 0;
    for (const [w, c] of rejectionsByWard) {
      if (c > topRejectionCount) {
        topRejectionCount = c;
        topRejectionWard = w;
      }
    }

    const integrity = integrityStats(verifiedRows as unknown as Resolution[]);
    const durability = refilledAfterVerification(
      rows as unknown as Report[],
      verifiedRows as unknown as Resolution[],
    );

    return NextResponse.json({
      total: rows.length,
      open,
      claimed,
      verified,
      verified_rate: rows.length ? verified / rows.length : null,
      median_days_to_verified: median,
      real_facilities: facilities.count ?? 0,
      ...integrity,
      spots_watched: durability.watched,
      spots_refilled: durability.refilled,
      top_rejection_ward: topRejectionWard,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
