"use client";

/**
 * Report list state + filtering, kept OUT of MapView.tsx on purpose.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports useReports(), filterReports().
 * Data schemas: consumes Report from src/lib/types.ts (created_at ISO-8601) via
 * GET /api/reports.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * WHY THIS FILE EXISTS: MapView imports react-leaflet, which touches `window` at module
 * scope. page.tsx loads MapView via next/dynamic ssr:false — but a *static* import of any
 * other symbol from that same module still pulls Leaflet into the server bundle and the
 * prerender dies with "window is not defined". Keeping this hook in its own Leaflet-free
 * module is what makes the dynamic import actually work.
 */

import { useEffect, useMemo, useState } from "react";
import type { Report, ReportStatus, WasteType } from "./types";

export function filterReports(
  reports: Report[],
  opts: {
    ward?: string | null;
    status?: ReportStatus | null;
    wasteType?: WasteType | null;
  },
): Report[] {
  return reports.filter((r) => {
    if (opts.ward && r.ward_id !== opts.ward) return false;
    if (opts.status && r.status !== opts.status) return false;
    if (opts.wasteType && r.waste_type !== opts.wasteType) return false;
    return true;
  });
}

/** Polls the report list (spec §7 — reload/poll refresh is enough for the demo). */
export function useReports(pollMs = 15_000) {
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/reports");
        const json = await res.json();
        if (!alive) return;
        if (json.error) setError(json.error);
        else {
          setReports(json.reports);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    load();
    const t = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pollMs]);

  const counts = useMemo(
    () => ({
      open: reports.filter((r) => r.status === "open").length,
      claimed: reports.filter((r) => r.status === "claimed").length,
      verified: reports.filter((r) => r.status === "verified_resolved").length,
    }),
    [reports],
  );

  return { reports, counts, error, setReports };
}
