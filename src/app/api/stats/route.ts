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

export async function GET() {
  try {
    const db = serverClient();

    const [reports, resolutions, facilities] = await Promise.all([
      db.from("reports").select("id,status,created_at,is_seed"),
      db
        .from("resolutions")
        .select("report_id,verified_at")
        .not("verified_at", "is", null),
      db.from("waste_facilities").select("id", { count: "exact", head: true }),
    ]);

    if (reports.error) throw new Error(reports.error.message);
    if (resolutions.error) throw new Error(resolutions.error.message);

    const rows = reports.data ?? [];
    const verifiedRows = resolutions.data ?? [];

    const firstVerified = new Map<string, string>();
    for (const r of verifiedRows) {
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

    return NextResponse.json({
      total: rows.length,
      open,
      claimed,
      verified,
      verified_rate: rows.length ? verified / rows.length : null,
      median_days_to_verified: median,
      real_facilities: facilities.count ?? 0,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
