"use client";

/**
 * Report list state + filtering, kept OUT of MapView.tsx on purpose.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports useReports() -> {reports, error, upsertLocal}, filterReports().
 * Data schemas: consumes Pin from src/lib/types.ts (created_at ISO-8601) via GET /api/reports.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * WHY THIS FILE EXISTS: it stays out of Map3D.tsx because anything page.tsx
 * imports statically from that module pulls maplibre-gl into the server bundle,
 * and maplibre touches `window` at module scope — which breaks the prerender
 * despite the dynamic ssr:false import.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Pin, ReportStatus } from "./types";

export function filterReports(
  reports: Pin[],
  opts: {
    zone?: string | null;
    status?: ReportStatus | null;
  },
): Pin[] {
  return reports.filter((r) => {
    if (opts.zone && r.zone !== opts.zone) return false;
    if (opts.status && r.status !== opts.status) return false;
    return true;
  });
}

/**
 * How long a row this device just created or changed is kept on top of the server list. The list
 * is edge-cached (s-maxage 60 + stale-while-revalidate 300), so a poll can hand back a copy from
 * before the change; without this a fresh report would vanish from the map on the next poll.
 */
const LOCAL_TTL_MS = 6 * 60_000;

/** Polls the report list (spec §7 — reload/poll refresh is enough for the demo). */
export function useReports(pollMs = 15_000) {
  const [server, setServer] = useState<Pin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Map<string, { pin: Pin; at: number }>>(new Map());

  const load = useCallback(async (fresh = false) => {
    try {
      // A unique query string misses the edge cache — used right after this device writes.
      const res = await fetch(fresh ? `/api/reports?fresh=${Date.now()}` : "/api/reports");
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setServer(json.reports);
        setError(null);
        // Drop local rows old enough that every cached copy now includes them.
        setLocal((m) => {
          const now = Date.now();
          const kept = [...m].filter(([, l]) => now - l.at < LOCAL_TTL_MS);
          return kept.length === m.size ? m : new Map(kept);
        });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, pollMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [pollMs, load]);

  /** Keep a just-written row (new report, new status) until the server list catches up. */
  const upsertLocal = useCallback(
    (pin: Pin) => {
      setLocal((m) => new Map(m).set(pin.id, { pin, at: Date.now() }));
      load(true);
    },
    [load],
  );

  const reports = useMemo(() => {
    if (local.size === 0) return server;
    const seen = new Set(server.map((r) => r.id));
    const added = [...local.values()].filter((l) => !seen.has(l.pin.id)).map((l) => l.pin);
    return [...added, ...server.map((r) => local.get(r.id)?.pin ?? r)];
  }, [server, local]);

  return { reports, error, upsertLocal };
}
