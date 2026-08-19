"use client";

/**
 * Ward leaderboard — spec §3 Flow C / §12.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports Leaderboard (default); calls GET /api/leaderboard.
 * Data schemas: consumes LeaderboardRow {ward_id, ward_name, total_reports,
 * total_verified_resolutions, verified_resolution_rate, avg_days_to_verified_resolution}.
 * No dates rendered directly — durations are numbers of days.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * Ranked by time-to-VERIFIED-resolution. Raw complaint volume is shown but deliberately
 * de-emphasised: ranking by it rewards noise, which is the failure CleanLoop exists to fix.
 */

import { useEffect, useState } from "react";

interface Row {
  ward_id: string;
  ward_name: string;
  total_reports: number;
  total_verified_resolutions: number;
  verified_resolution_rate: number | null;
  avg_days_to_verified_resolution: number | null;
}

export default function Leaderboard({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/leaderboard");
        const json = await res.json();
        if (json.error) setError(json.error);
        else setRows(json.leaderboard);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ward accountability</h2>
          <button onClick={onClose} className="text-2xl leading-none text-neutral-400">
            ×
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Ranked by average days to <strong>verified</strong> resolution — not by
          complaint count.
        </p>

        {loading && (
          <div className="py-8 text-center text-sm text-neutral-500">Loading…</div>
        )}
        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-2 text-xs text-red-800">{error}</div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="py-8 text-center text-sm text-neutral-500">
            No reports yet. Seed the database or submit one.
          </div>
        )}

        {rows.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-neutral-500">
                <th className="pb-2">Ward</th>
                <th className="pb-2 text-right">Avg days</th>
                <th className="pb-2 text-right">Verified</th>
                <th className="pb-2 text-right">Reports</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ward_id} className="border-b last:border-0">
                  <td className="py-2 font-medium">{r.ward_name}</td>
                  <td className="py-2 text-right">
                    {r.avg_days_to_verified_resolution === null
                      ? "—"
                      : r.avg_days_to_verified_resolution.toFixed(1)}
                  </td>
                  <td className="py-2 text-right">
                    {r.total_verified_resolutions}
                    {r.verified_resolution_rate !== null && (
                      <span className="ml-1 text-xs text-neutral-400">
                        ({(r.verified_resolution_rate * 100).toFixed(0)}%)
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right text-neutral-500">{r.total_reports}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-4 text-xs text-neutral-400">
          Wards are nearest-locality approximations, not official BBMP ward boundaries.
        </p>
      </div>
    </div>
  );
}
