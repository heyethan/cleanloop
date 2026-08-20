"use client";

/**
 * CleanLoop main screen — 3D map / list, with filters, language and dimension toggles.
 *
 * Importers/callers: Next.js App Router renders this at "/".
 * Affected API: none exported; composes Map3D, ListView, ReportSheet, ResolveSheet,
 * Leaderboard.
 * Data schemas: holds Report[] in state (created_at ISO-8601); calls GET /api/stats for
 * {total, open, claimed, verified, verified_rate, median_days_to_verified, real_facilities}.
 * User instruction, verbatim: "1. We already have a map view... give an option for list
 * view as well 2. Create a severity filter dropdown and status filter as well
 * 3. Localization option with english or kannada, english by default 4. let map view be
 * only in dark mode 5. have map option for 2D or 3D which choice"
 *
 * UX decisions applied:
 *  - Anchoring / Social Proof: the first and largest number is VERIFIED cleanups.
 *  - Fitts + thumb zone: primary CTA is a full-width pill in the bottom safe area.
 *  - Progressive disclosure: filters stay behind a toggle.
 *
 * The map is dark-only by design — there is no light theme path anywhere in this app.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReports, filterReports } from "@/lib/useReports";
import ReportSheet from "@/components/ReportSheet";
import ResolveSheet from "@/components/ResolveSheet";
import Leaderboard from "@/components/Leaderboard";
import ListView, { type SortMode } from "@/components/ListView";
import Island, { IslandCollapse } from "@/components/Island";
import { WARDS } from "@/lib/wards";
import { useLang } from "@/lib/i18n";
import type { MapHandle, MapMode } from "@/components/Map3D";
import type { Report, ReportStatus } from "@/lib/types";

const Map3D = dynamic(() => import("@/components/Map3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#070a0f]">
      <div className="text-xs uppercase tracking-[0.25em] text-white/50">loading city</div>
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

type View = "map" | "list";

export default function Home() {
  const { reports, error, setReports } = useReports();
  const { lang, setLang, t } = useLang();
  const [stats, setStats] = useState<Stats | null>(null);
  const [reporting, setReporting] = useState(false);
  const [selected, setSelected] = useState<Report | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showFacilities, setShowFacilities] = useState(true);
  const [ward, setWard] = useState<string | null>(null);
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const [severity, setSeverity] = useState<number | null>(null);
  const [view, setView] = useState<View>("map");
  const [mapMode, setMapMode] = useState<MapMode>("3d");
  const [sort, setSort] = useState<SortMode>("severity");
  /*
   * Collapsed by default on phones — the island exists because the old fixed card ate a
   * third of the map on a 6.1" screen. On a wide screen there is room to keep it open.
   */
  const [islandOpen, setIslandOpen] = useState(false);
  useEffect(() => {
    setIslandOpen(window.matchMedia("(min-width: 640px)").matches);
  }, []);
  const mapRef = useRef<MapHandle>(null);

  /*
   * MUST be memoised. filterReports returns a new array identity on every call, and this
   * feeds Map3D's source-sync effect — unmemoised it re-uploaded the whole GeoJSON to
   * the GPU on every render.
   */
  const visible = useMemo(() => {
    const base = filterReports(reports, { ward, status });
    return severity === null ? base : base.filter((r) => r.severity === severity);
  }, [reports, ward, status, severity]);

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
    // Collapse the island as a sheet takes over: two glass layers stacked on each other
    // is exactly the "light material on light material" the HIG warns about.
    setIslandOpen(false);
    mapRef.current?.flyToReport(r);
  }, []);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#070a0f] text-white">
      <div className="absolute inset-0">
        {view === "map" ? (
          <Map3D
            ref={mapRef}
            reports={visible}
            onSelect={handleSelect}
            showFacilities={showFacilities}
            mode={mapMode}
          />
        ) : (
          <ListView
            reports={visible}
            sort={sort}
            onSort={setSort}
            onSelect={(r) => setSelected(r)}
            lang={lang}
          />
        )}
      </div>

      {view === "map" && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-black/80 via-black/40 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
        </>
      )}

      {/* ---------------------------------------------------------------- header */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Island
          open={islandOpen}
          onToggle={() => setIslandOpen((v) => !v)}
          collapsedMetric={String(stats?.verified ?? "—")}
          collapsedLabel={t("verified_clean")}
          expanded={
            <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.28em] text-white/55">
                  {t("city")}
                </div>
                <h1 className="mt-1 text-[26px] font-semibold leading-none tracking-tight">
                  CleanLoop
                </h1>
              </div>

              <div className="flex items-center gap-1.5">
                <Segmented
                  options={[
                    { value: "en", label: "EN" },
                    { value: "kn", label: "ಕ" },
                  ]}
                  value={lang}
                  onChange={(v) => setLang(v as "en" | "kn")}
                />
                <button
                  onClick={() => setShowBoard(true)}
                  className="group flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-3.5 pr-1.5 text-xs font-medium text-white/80 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97]"
                >
                  {t("wards")}
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[11px] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5">
                    ↗
                  </span>
                </button>
                <IslandCollapse
                  onClick={() => setIslandOpen(false)}
                  label="Collapse panel"
                />
              </div>
            </div>

            {/* ANCHOR: verified first, biggest. Never lead with complaint volume. */}
            <div className="mt-4 flex items-end gap-5">
              <div>
                <div className="text-[34px] font-semibold leading-none tracking-tight text-[#22c98a] tabular-nums">
                  {stats?.verified ?? "—"}
                </div>
                <div className="mt-1 text-[11px] leading-tight text-white/60">
                  {t("verified_clean")}
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
                  {t("median_to_verify")}
                </div>
              </div>
              <div className="mb-0.5 h-9 w-px bg-white/10" />
              <div>
                <div className="text-lg font-medium leading-none tabular-nums text-white/85">
                  {stats ? `${Math.round((stats.verified_rate ?? 0) * 100)}%` : "—"}
                </div>
                <div className="mt-1 text-[11px] leading-tight text-white/60">
                  {t("closure_rate")}
                </div>
              </div>
            </div>

            {/* view + dimension switches */}
            <div className="mt-3.5 flex items-center gap-2">
              <Segmented
                options={[
                  { value: "map", label: t("map_view") },
                  { value: "list", label: t("list_view") },
                ]}
                value={view}
                onChange={(v) => setView(v as View)}
                grow
              />
              {view === "map" && (
                <Segmented
                  options={[
                    { value: "3d", label: t("dim_3d") },
                    { value: "2d", label: t("dim_2d") },
                  ]}
                  value={mapMode}
                  onChange={(v) => setMapMode(v as MapMode)}
                />
              )}
            </div>

            <div className="mt-3 flex items-center gap-3 text-[11px] text-white/60">
              <Dot colour="#ff3b30" label={`${stats?.open ?? 0} ${t("open_count")}`} />
              <Dot colour="#ffb020" label={`${stats?.claimed ?? 0} ${t("held_count")}`} />
              <button
                onClick={() => setShowFilters((v) => !v)}
                className="ml-auto -my-3 flex h-11 min-w-11 items-center justify-center px-3 text-[11px] text-white/60 underline-offset-4 transition-colors hover:text-white/80"
              >
                {showFilters ? t("hide") : t("filter")}
              </button>
            </div>

            {/* Progressive disclosure — filters are secondary, so they stay hidden */}
            <div
              className={`grid overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                showFilters ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 space-y-2">
                <div className="flex gap-2">
                  <Select value={ward ?? ""} onChange={(v) => setWard(v || null)}>
                    <option value="" className="bg-neutral-900">
                      {t("all_wards")}
                    </option>
                    {WARDS.map((w) => (
                      <option key={w.id} value={w.id} className="bg-neutral-900">
                        {w.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={status ?? ""}
                    onChange={(v) => setStatus((v || null) as ReportStatus | null)}
                  >
                    <option value="" className="bg-neutral-900">
                      {t("all_statuses")}
                    </option>
                    <option value="open" className="bg-neutral-900">
                      {t("status_open")}
                    </option>
                    <option value="claimed" className="bg-neutral-900">
                      {t("status_claimed")}
                    </option>
                    <option value="verified_resolved" className="bg-neutral-900">
                      {t("status_verified")}
                    </option>
                  </Select>
                </div>

                <Select
                  value={severity === null ? "" : String(severity)}
                  onChange={(v) => setSeverity(v === "" ? null : Number(v))}
                  full
                >
                  <option value="" className="bg-neutral-900">
                    {t("all_severities")}
                  </option>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n} className="bg-neutral-900">
                      {t("severity_label")} {n}/5
                    </option>
                  ))}
                </Select>

                {view === "map" && (
                  <label className="flex h-11 items-center gap-2.5 text-[11px] text-white/60">
                    <input
                      type="checkbox"
                      checked={showFacilities}
                      onChange={(e) => setShowFacilities(e.target.checked)}
                      className="h-5 w-5 shrink-0 accent-[#3f8cff]"
                    />
                    {t("show_bins", { n: stats?.real_facilities ?? 0 })}
                  </label>
                )}
              </div>
            </div>

            {error && <div className="mt-2 text-[11px] text-red-400">{error}</div>}
            </>
          }
        />
      </header>

      {/* ------------------------------------------------------------ bottom CTA */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          onClick={() => setReporting(true)}
          className="group mx-auto flex w-full max-w-md items-center justify-center gap-3 rounded-full border border-white/15 bg-white py-4 text-[15px] font-semibold text-black shadow-[0_20px_50px_-12px_rgba(255,255,255,0.35)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.975]"
        >
          {t("report_cta")}
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/10 text-xs transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-[1px]">
            ↗
          </span>
        </button>
      </div>

      {reporting && (
        <ReportSheet
          lang={lang}
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
          lang={lang}
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

      {showBoard && <Leaderboard lang={lang} onClose={() => setShowBoard(false)} />}
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

function Segmented({
  options,
  value,
  onChange,
  grow,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  grow?: boolean;
}) {
  return (
    <div
      className={`flex h-11 items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1 ${grow ? "flex-1" : ""}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`h-full rounded-full px-3 text-xs font-medium transition-colors duration-300 ${
            grow ? "flex-1" : ""
          } ${value === o.value ? "bg-white text-black" : "text-white/60 hover:text-white/85"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
  full,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-11 rounded-xl border border-white/10 bg-white/5 px-2.5 text-xs text-white/80 outline-none ${full ? "w-full" : "w-1/2"}`}
    >
      {children}
    </select>
  );
}
