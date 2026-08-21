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
import CommandPalette from "@/components/CommandPalette";
import { WARDS } from "@/lib/wards";
import officialWards from "@/data/wards.json";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeWard, setActiveWard] = useState<{
    id: string;
    name: string;
    kind: "official" | "cluster";
  } | null>(null);

  /** Ward ids OSM actually has a surveyed boundary for — 5 of 12 at time of writing. */
  const officialIds = useMemo(
    () =>
      new Set(
        (officialWards as { features: { properties: { id: string } }[] }).features.map(
          (f) => f.properties.id,
        ),
      ),
    [],
  );

  /*
   * Publish the island's LIVE height as --island-h so ListView can pad by it.
   *
   * ListView previously hardcoded pt-[248px] to clear the expanded island. Measured on a
   * 393x852 iPhone 14 Pro the island is 249px tall starting at y=12, so its bottom edge
   * is at y=261 and it covered the first 13px of the list. Any constant tuned to another
   * component's rendered height is a bug waiting for that component to change — so
   * measure it instead of guessing again.
   */
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty(
        "--island-h",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /*
   * The island is a MAP heads-up display. Over a scrolling list it is only an occluder,
   * so entering list view collapses it. ListView carries its own "back to map" control
   * so this never costs a round trip through the HUD.
   */
  useEffect(() => {
    if (view === "list") setIslandOpen(false);
  }, [view]);

  const flyToWard = useCallback((wardId: string) => {
    setView("map");
    setIslandOpen(false);
    mapRef.current?.flyToWard(wardId);
  }, []);

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
      {/*
        BOTH layers stay mounted, always.

        This used to be a `view === "map" ? <Map3D/> : <ListView/>` ternary. Map3D is a
        `next/dynamic` ssr:false import, so switching to the list DESTROYED the MapLibre
        instance: coming back rebuilt the map, refetched the style and every vector tile,
        and reset the camera to fitBounds. That teardown-and-rebuild was the "glitch/delay"
        on the view switch — it was never a loading state, so a skeleton would have hidden
        it rather than fixed it.

        Kept mounted and crossfaded, the switch is instant and the camera survives the
        round trip. The cost is one live GL context while you are reading the list, which
        is far cheaper than re-initialising the whole map every toggle.
      */}
      <div className="absolute inset-0">
        <div
          aria-hidden={view !== "map"}
          className="absolute inset-0 transition-opacity duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            opacity: view === "map" ? 1 : 0,
            pointerEvents: view === "map" ? "auto" : "none",
          }}
        >
          <Map3D
            ref={mapRef}
            reports={visible}
            onSelect={handleSelect}
            showFacilities={showFacilities}
            mode={mapMode}
            onActiveWard={setActiveWard}
          />
        </div>

        <div
          aria-hidden={view !== "list"}
          className="absolute inset-0 transition-opacity duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            opacity: view === "list" ? 1 : 0,
            pointerEvents: view === "list" ? "auto" : "none",
          }}
        >
          <ListView
            reports={visible}
            sort={sort}
            onSort={setSort}
            onSelect={(r) => setSelected(r)}
            onBackToMap={() => setView("map")}
            lang={lang}
          />
        </div>
      </div>

      {view === "map" && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-black/80 via-black/40 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
        </>
      )}

      {/* ---------------------------------------------------------------- header */}
      <header
        ref={headerRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
      >
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

              {/*
                MEASURED: at 393px this row has 323px of usable width, but title (128) +
                gap (12) + the old cluster (221 = lang 83 + Wards 90 + collapse 36) came
                to 361px. The 38px of overflow was clipped by the island's own
                overflow-hidden, which sliced 14px off the collapse chevron. Moving the
                90px Wards button down to the meta row brings this to 265px and leaves
                real headroom for longer localised labels.
              */}
              <div className="flex shrink-0 items-center gap-1.5">
                <Segmented
                  options={[
                    { value: "en", label: "EN" },
                    { value: "kn", label: "ಕ" },
                  ]}
                  value={lang}
                  onChange={(v) => setLang(v as "en" | "kn")}
                />
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

            {/* Locality search + leaderboard. Wards moved here off the title row. */}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => setSearchOpen(true)}
                className="group flex h-11 flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 text-xs font-medium text-white/60 transition-colors duration-300 hover:text-white/85"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.4" />
                  <path
                    d="M10.5 10.5L14 14"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="truncate">{t("search_placeholder")}</span>
                <kbd className="ml-auto hidden shrink-0 rounded border border-white/15 px-1.5 py-0.5 font-sans text-[10px] text-white/45 sm:block">
                  ⌘K
                </kbd>
              </button>
              <button
                onClick={() => setShowBoard(true)}
                className="group flex h-11 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-3.5 pr-1.5 text-xs font-medium text-white/80 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97]"
              >
                {t("wards")}
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[11px] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5">
                  ↗
                </span>
              </button>
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
        {/*
          Name the outlined locality, and say WHICH KIND of shape it is. OSM has a
          surveyed boundary for only 5 of the 12 localities; the rest fall back to a hull
          of their own reports. Solid vs dashed here matches the map exactly, so the two
          can never be confused for one another.
        */}
        {view === "map" && activeWard && (
          <div className="pointer-events-none mx-auto mb-2.5 flex w-full max-w-md items-center gap-2.5 rounded-2xl border border-white/10 bg-black/60 px-3.5 py-2 backdrop-blur-xl">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-[3px]"
              style={{
                border: `1.5px ${
                  activeWard.kind === "official" ? "solid" : "dashed"
                } ${activeWard.kind === "official" ? "#6cb6ff" : "#93a4b8"}`,
              }}
            />
            {/*
              Two lines, not one. On a 393px screen the single-line version truncated to
              "Koramang… Case cluster · no official boundary in OpenStre…", which defeats
              the entire point of saying which kind of shape this is.
            */}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium leading-tight text-white/90">
                {activeWard.name}
              </span>
              <span className="block truncate text-[10.5px] leading-tight text-white/50">
                {activeWard.kind === "official"
                  ? t("boundary_official")
                  : `${t("boundary_cluster")} — ${t("boundary_cluster_note")}`}
              </span>
            </span>
          </div>
        )}

        <button
          onClick={() => setReporting(true)}
          className="group mx-auto flex w-full max-w-md items-center justify-center gap-3 rounded-full border border-white/15 bg-white py-4 text-[15px] font-semibold text-black shadow-[0_20px_50px_-12px_rgba(255,255,255,0.35)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.975]"
        >
          {t("report_cta")}
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/10 text-xs transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-[1px] group-hover:translate-x-0.5">
            ↗
          </span>
        </button>
      </div>

      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onPick={flyToWard}
        officialIds={officialIds}
        lang={lang}
      />

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
