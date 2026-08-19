"use client";

/**
 * CleanLoop main screen — map + report button + leaderboard.
 *
 * Importers/callers: Next.js App Router renders this at "/".
 * Affected API: none exported; composes MapView, ReportSheet, ResolveSheet, Leaderboard.
 * Data schemas: holds Report[] in state (created_at ISO-8601), mutated optimistically
 * after a report or resolution.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * MapView is loaded with ssr:false because Leaflet touches window at import time.
 */

import dynamic from "next/dynamic";
import { useState } from "react";
import { useReports, filterReports } from "@/lib/useReports";
import ReportSheet from "@/components/ReportSheet";
import ResolveSheet from "@/components/ResolveSheet";
import Leaderboard from "@/components/Leaderboard";
import { WARDS } from "@/lib/wards";
import type { Report, ReportStatus } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-neutral-100" />,
});

export default function Home() {
  const { reports, counts, error, setReports } = useReports();
  const [reporting, setReporting] = useState(false);
  const [selected, setSelected] = useState<Report | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [ward, setWard] = useState<string | null>(null);
  const [status, setStatus] = useState<ReportStatus | null>(null);

  const visible = filterReports(reports, { ward, status });

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0">
        <MapView reports={visible} onSelect={(r) => setSelected(r)} />
      </div>

      {/* Header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] p-3">
        <div className="pointer-events-auto mx-auto max-w-md rounded-xl bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-baseline justify-between">
            <h1 className="text-base font-semibold">CleanLoop</h1>
            <button
              onClick={() => setShowBoard(true)}
              className="text-xs font-medium text-blue-600"
            >
              Leaderboard
            </button>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">
            Report a dump. AI verifies the cleanup before the case closes.
          </p>

          <div className="mt-2 flex gap-3 text-xs">
            <Legend colour="#dc2626" label={`Open ${counts.open}`} />
            <Legend colour="#eab308" label={`Claimed ${counts.claimed}`} />
            <Legend colour="#16a34a" label={`Verified ${counts.verified}`} />
          </div>

          <div className="mt-2 flex gap-2">
            <select
              value={ward ?? ""}
              onChange={(e) => setWard(e.target.value || null)}
              className="w-1/2 rounded border px-2 py-1 text-xs"
            >
              <option value="">All wards</option>
              {WARDS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select
              value={status ?? ""}
              onChange={(e) => setStatus((e.target.value || null) as ReportStatus | null)}
              className="w-1/2 rounded border px-2 py-1 text-xs"
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="claimed">Claimed, unverified</option>
              <option value="verified_resolved">Verified clean</option>
            </select>
          </div>

          {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
        </div>
      </div>

      {/* Primary action */}
      <div className="absolute inset-x-0 bottom-0 z-[500] p-4">
        <button
          onClick={() => setReporting(true)}
          className="mx-auto block w-full max-w-md rounded-xl bg-neutral-900 py-3.5 font-medium text-white shadow-lg"
        >
          Report a dump spot
        </button>
      </div>

      {reporting && (
        <ReportSheet
          onClose={() => setReporting(false)}
          onReported={(r) => setReports((prev) => [r, ...prev])}
        />
      )}

      {selected && (
        <ResolveSheet
          report={selected}
          onClose={() => setSelected(null)}
          onResolved={(id, newStatus) =>
            setReports((prev) =>
              prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)),
            )
          }
        />
      )}

      {showBoard && <Leaderboard onClose={() => setShowBoard(false)} />}
    </main>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: colour }}
      />
      {label}
    </span>
  );
}
