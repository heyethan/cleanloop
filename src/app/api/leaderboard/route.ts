/**
 * GET /api/leaderboard — wards ranked by verified resolution performance (spec §3 Flow C).
 *
 * Importers/callers: called over HTTP by src/components/Leaderboard.tsx.
 * Not imported by other modules.
 * Affected API: this route's own HTTP contract; exports the LeaderboardRow type.
 * Data schemas: reads `reports` and `resolutions`. Computed on read, never stored
 * (spec §5 "LeaderboardSnapshot (computed, not stored)"). Timestamps are ISO-8601.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * The ranking metric is average days-to-VERIFIED-resolution, not complaint count —
 * counting complaints rewards noise, which is the whole thing CleanLoop argues against.
 */

import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { WARDS } from "@/lib/wards";
import type { Report, Resolution } from "@/lib/types";

export interface LeaderboardRow {
  ward_id: string;
  ward_name: string;
  total_reports: number;
  total_verified_resolutions: number;
  verified_resolution_rate: number | null;
  avg_days_to_verified_resolution: number | null;
}

export async function GET() {
  try {
    const db = serverClient();

    const [reportsRes, resolutionsRes] = await Promise.all([
      db.from("reports").select("*"),
      db.from("resolutions").select("*").not("verified_at", "is", null),
    ]);
    if (reportsRes.error) throw new Error(reportsRes.error.message);
    if (resolutionsRes.error) throw new Error(resolutionsRes.error.message);

    const reports = (reportsRes.data ?? []) as Report[];
    const resolutions = (resolutionsRes.data ?? []) as Resolution[];

    // Earliest verified resolution per report — a report can accrue several attempts
    // (a yellow "claimed" pass before a green one), and only the first green counts.
    const firstVerified = new Map<string, string>();
    for (const r of resolutions) {
      if (!r.verified_at) continue;
      const prev = firstVerified.get(r.report_id);
      if (!prev || r.verified_at < prev) firstVerified.set(r.report_id, r.verified_at);
    }

    const byWard = new Map<string, { total: number; verified: number; days: number[] }>();
    for (const rep of reports) {
      if (!rep.ward_id) continue;
      const acc = byWard.get(rep.ward_id) ?? { total: 0, verified: 0, days: [] };
      acc.total++;
      const verifiedAt = firstVerified.get(rep.id);
      if (verifiedAt) {
        acc.verified++;
        const days =
          (new Date(verifiedAt).getTime() - new Date(rep.created_at).getTime()) /
          86_400_000;
        // Guard against clock skew or bad seed data producing negative durations.
        if (days >= 0) acc.days.push(days);
      }
      byWard.set(rep.ward_id, acc);
    }

    const rows: LeaderboardRow[] = [];
    for (const [wardId, acc] of byWard) {
      const ward = WARDS.find((w) => w.id === wardId);
      rows.push({
        ward_id: wardId,
        ward_name: ward?.name ?? wardId,
        total_reports: acc.total,
        total_verified_resolutions: acc.verified,
        verified_resolution_rate: acc.total > 0 ? acc.verified / acc.total : null,
        avg_days_to_verified_resolution: acc.days.length
          ? acc.days.reduce((a, b) => a + b, 0) / acc.days.length
          : null,
      });
    }

    // Best first: fastest verified turnaround. Wards with no verified resolution yet sort
    // last rather than looking like a perfect score.
    rows.sort((a, b) => {
      const av = a.avg_days_to_verified_resolution;
      const bv = b.avg_days_to_verified_resolution;
      if (av === null && bv === null) return b.total_reports - a.total_reports;
      if (av === null) return 1;
      if (bv === null) return -1;
      return av - bv;
    });

    return NextResponse.json({ leaderboard: rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
