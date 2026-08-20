"use client";

/**
 * CleanLoop main screen — 3D map with floating glass panels.
 *
 * Importers/callers: Next.js App Router renders this at "/".
 * Affected API: none exported; composes Map3D, ReportSheet, ResolveSheet, Leaderboard.
 * Data schemas: holds Report[] in state (created_at ISO-8601); calls GET /api/stats
 * for {total, open, claimed, verified, verified_rate, median_days_to_verified,
 * real_facilities}.
 * User instruction, verbatim: "also improve the ui/ux of the website"
 *
 * UX decisions applied (see README "UX rationale"):
 *  - Anchoring / Social Proof: the first and largest number is VERIFIED cleanups,
 *    never complaint volume. Complaint counts prove nothing; closure proves the loop.
 *  - Fitts + thumb zone: the primary CTA is a full-width pill pinned to the bottom
 *    safe area, the easiest place to hit one-handed on a 6.1" phone.
 *  - Progressive disclosure: filters live behind a toggle, not permanently on screen.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReports, filterReports } from "@/lib/useReports";
import ReportSheet from "@/components/ReportSheet";
import ResolveSheet from "@/components/ResolveSheet";
import Leaderboard from "@/components/Leaderboard";
import { WARDS } from "@/lib/wards";
import type { MapHandle } from "@/components/Map3D";
import type { Report, ReportStatus } from "@/lib/types";

const Map3D = dynamic(() => import("@/components/Map3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#070a0f]">
      <div className="text-xs uppercase tracking-[0.25em] text-white/50">
        loading city
      </div>
    </div>
  ),
});

interface Stats {
  total: number;
  open: number;
  claimed: number;
  verified: number;
  verified_rate: number | null;
  median_days_to_verified: number | null;
  real_facilities: number;
}

export default function Home() {
  const { reports, error, setReports } = useReports();
  const [stats, setStats] = useState<Stats | null>(null);
  const [reporting, setReporting] = useState(false);
  const [selected, setSelected] = useState<Report | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showFacilities, setShowFacilities] = useState(true);
  const [ward, setWard] = useState<string | null>(null);
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const mapRef = useRef<MapHandle>(null);

  /*
   * MUST be memoised. filterReports returns a new array identity on every call, and this
   * value is a dependency of Map3D's source-sync effect — so an unmemoised version
   * re-serialised and re-uploaded the entire GeoJSON to the GPU on every single render
   * (every sheet open/close, every 15s stats refresh, every filter keystroke).
   */
  const visible = useMemo(
    () => filterReports(reports, { ward, status }),
    [reports, ward, status],
  );

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      const j = await res.json();
      if (!j.error) setStats(j);
    } catch {
      /* header degrades to em-dashes rather than breaking the map */
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleSelect = useCallback((r: Report) => {
    setSelected(r);
    mapRef.current?.flyToReport(r);
  }, []);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#070a0f] text-white">
      <div className="absolute inset-0">
        <Map3D
          ref={mapRef}
          reports={visible}
          onSelect={handleSelect}
          showFacilities={showFacilities}
        />
      </div>

      {/* Vignettes so glass panels stay legible over bright map areas */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-black/80 via-black/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />

      {/* ---------------------------------------------------------------- header */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto mx-auto w-full max-w-md rounded-[1.75rem] border border-white/10 bg-white/[0.06] p-1.5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
          <div className="rounded-[calc(1.75rem-0.375rem)] bg-black/40 p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.28em] text-white/55">
                  Bengaluru
                </div>
                <h1 className="mt-1 text-[26px] font-semibold leading-none tracking-tight">
                  CleanLoop
                </h1>
              </div>
              <button
                onClick={() => setShowBoard(true)}
                className="group flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-4 pr-1.5 text-xs font-medium text-white/80 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97]"
              >
                Wards
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[11px] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5">
                  ↗
                </span>
              </button>
            </div>

            {/* ANCHOR: verified first, biggest. Never lead with complaint volume. */}
            <div className="mt-4 flex items-end gap-5">
              <div>
                <div className="text-[34px] font-semibold leading-none tracking-tight text-[#22c98a] tabular-nums">
                  {stats?.verified ?? "—"}
                </div>
                <div className="mt-1 text-[11px] leading-tight text-white/60">
                  verified clean
                </div>
              </div>
              <div className="mb-0.5 h-9 w-px bg-white/10" />
              <div>
                <div className="text-lg font-medium leading-none tabular-nums text-white/85">
                  {stats?.median_days_to_verified != null
                    ? `${stats.median_days_to_verified.toFixed(1)}d`
                    : "—"}
                </div>
                <div className="mt-1 text-[11px] leading-tight text-white/60">
                  median to verify
                </div>
              </div>
              <div className="mb-0.5 h-9 w-px bg-white/10" />
              <div>
                <div className="text-lg font-medium leading-none tabular-nums text-white/85">
                  {stats ? `${Math.round((stats.verified_rate ?? 0) * 100)}%` : "—"}
                </div>
                <div className="mt-1 text-[11px] leading-tight text-white/60">
                  closure rate
                </div>
              </div>
            </div>

            <div className="mt-3.5 flex items-center gap-3 text-[11px] text-white/55">
              <Dot colour="#ff3b30" label={`${stats?.open ?? 0} open`} />
              <Dot colour="#ffb020" label={`${stats?.claimed ?? 0} held`} />
              <button
                onClick={() => setShowFilters((v) => !v)}
                className="ml-auto -my-3 flex h-11 min-w-11 items-center justify-center px-3 text-[11px] text-white/60 underline-offset-4 transition-colors hover:text-white/80"
              >
                {showFilters ? "hide" : "filter"}
              </button>
            </div>

            {/* Progressive disclosure — filters are secondary, so they stay hidden */}
            <div
              className={`grid overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                showFilters
                  ? "mt-3 grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0">
                <div className="flex gap-2">
                  <select
                    value={ward ?? ""}
                    onChange={(e) => setWard(e.target.value || null)}
                    className="h-11 w-1/2 rounded-xl border border-white/10 bg-white/5 px-2.5 text-xs text-white/80 outline-none"
                  >
                    <option value="" className="bg-neutral-900">
                      All wards
                    </option>
                    {WARDS.map((w) => (
                      <option key={w.id} value={w.id} className="bg-neutral-900">
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={status ?? ""}
                    onChange={(e) =>
                      setStatus((e.target.value || null) as ReportStatus | null)
                    }
                    className="h-11 w-1/2 rounded-xl border border-white/10 bg-white/5 px-2.5 text-xs text-white/80 outline-none"
                  >
                    <option value="" className="bg-neutral-900">
                      All statuses
                    </option>
                    <option value="open" className="bg-neutral-900">
                      Open
                    </option>
                    <option value="claimed" className="bg-neutral-900">
                      Held for review
                    </option>
                    <option value="verified_resolved" className="bg-neutral-900">
                      Verified clean
                    </option>
                  </select>
                </div>
                <label className="mt-1 flex h-11 items-center gap-2.5 text-[11px] text-white/60">
                  <input
                    type="checkbox"
                    checked={showFacilities}
                    onChange={(e) => setShowFacilities(e.target.checked)}
                    className="h-5 w-5 shrink-0 accent-[#3f8cff]"
                  />
                  Show {stats?.real_facilities ?? 0} real OSM waste bins
                </label>
              </div>
            </div>

            {error && <div className="mt-2 text-[11px] text-red-400">{error}</div>}
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ bottom CTA */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          onClick={() => setReporting(true)}
          className="group mx-auto flex w-full max-w-md items-center justify-center gap-3 rounded-full border border-white/15 bg-white py-4 text-[15px] font-semibold text-black shadow-[0_20px_50px_-12px_rgba(255,255,255,0.35)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.975]"
        >
          Report a dump spot
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/10 text-xs transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-[1px]">
            ↗
          </span>
        </button>
      </div>

      {reporting && (
        <ReportSheet
          onClose={() => setReporting(false)}
          onReported={(r) => {
            setReports((prev) => [r, ...prev]);
            mapRef.current?.flyToReport(r);
            loadStats();
          }}
        />
      )}

      {selected && (
        <ResolveSheet
          report={selected}
          onClose={() => setSelected(null)}
          onResolved={(id, newStatus) => {
            setReports((prev) =>
              prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)),
            );
            loadStats();
          }}
        />
      )}

      {showBoard && <Leaderboard onClose={() => setShowBoard(false)} />}
    </main>
  );
}

function Dot({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: colour, boxShadow: `0 0 8px ${colour}` }}
      />
      {label}
    </span>
  );
}
