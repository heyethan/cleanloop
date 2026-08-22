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
import MapLoader from "@/components/MapLoader";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
      <div className="text-xs uppercase tracking-[0.25em] text-white/60">loading city</div>
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
  /* durable verification — see src/lib/durability.ts */
  claims_total: number;
  claims_rejected: number;
  rejection_rate: number | null;
  /**
   * The ward with the most REJECTED claims. The evidence pack leads with its rejection log,
   * so the entry link below targets this rather than the busiest ward — those differ.
   */
  top_rejection_ward: string | null;
  spots_watched: number;
  spots_refilled: number;
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
  /** True once MapLibre has painted. Drives the loader overlay, nothing else. */
  const [mapReady, setMapReady] = useState(false);
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
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (view !== "list") return;
    /*
     * Wait for the segmented thumb to finish travelling before collapsing.
     *
     * Collapsing immediately unmounts the control mid-animation, so the one toggle the
     * slide matters most on — Map to List — was the one place you never saw it. The
     * delay is the spring's duration plus a little, so the two motions read as a
     * sequence (thumb lands, then the panel folds) rather than a collision.
     */
    const delay = reduceMotion ? 0 : SEG_SPRING.duration * 1000 + 60;
    const timer = window.setTimeout(() => setIslandOpen(false), delay);
    return () => window.clearTimeout(timer);
  }, [view, reduceMotion]);

  /*
   * DESKTOP IS NOT A TALL PHONE.
   *
   * Measured at 1440x900, every control sat in a 448px column and 69% of the viewport
   * was empty black — the mobile layout stretched, not a desktop layout. On a wide
   * screen the map and the list can coexist, so `wide` switches the composition from
   * "one column, crossfade between map and list" to "list rail on the left, map always
   * visible on the right". The phone layout is untouched.
   */
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /** How many filters are narrowing the map right now — surfaced on the filter button. */
  const activeFilterCount =
    (ward ? 1 : 0) + (status ? 1 : 0) + (severity !== null ? 1 : 0);

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
          aria-hidden={view !== "map" && !wide}
          className="absolute inset-0 transition-opacity duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            // On a wide screen the map never hides — the list docks beside it.
            opacity: wide || view === "map" ? 1 : 0,
            pointerEvents: wide || view === "map" ? "auto" : "none",
          }}
        >
          <Map3D
            ref={mapRef}
            reports={visible}
            onSelect={handleSelect}
            showFacilities={showFacilities}
            mode={mapMode}
            onActiveWard={setActiveWard}
            onReady={() => setMapReady(true)}
          />
          {/*
            Importers/callers: this route only. Affected API: none exported.
            Data schemas: none; MapLoader renders no data.
            User instruction, verbatim: "implement a loader animation using animation.js
            three.js or wtv so that map loads by the time it's done."

            Mounted inside the map wrapper so it covers exactly the area that sits blank
            while MapLibre fetches its style and first tiles.
          */}
          <MapLoader ready={mapReady} lang={lang} />
        </div>

        <div
          aria-hidden={view !== "list"}
          className={`absolute inset-y-0 left-0 transition-opacity duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
            wide
              ? "w-[440px] border-r border-white/10 shadow-[8px_0_40px_-12px_rgba(0,0,0,0.9)]"
              : "right-0"
          }`}
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
        className="pointer-events-none absolute top-0 z-30 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] left-0 right-0 lg:right-auto lg:w-[440px]"
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
                    // Symmetric labels: "EN" against a lone "ಕ" read as a full word
                    // against a fragment. Both are now the language's own short name.
                    { value: "en", label: "EN" },
                    { value: "kn", label: "ಕನ್ನಡ" },
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

            {/*
              ANCHOR: verified first, biggest. Never lead with complaint volume.

              SERIAL POSITION: first and last are the two positions people retain, so
              the weakest number must not sit in either. "37% closure rate" was last —
              a sub-half figure in the most memorable slot, reading as a grade rather
              than a status. It moves to the middle and the median-days figure (a
              genuinely strong number) takes the closing position. Same three facts,
              nothing hidden, better ordered.
            */}
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
                  {stats ? `${Math.round((stats.verified_rate ?? 0) * 100)}%` : "—"}
                </div>
                <div className="mt-1 text-[11px] leading-tight text-white/60">
                  {t("closure_rate")}
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
            </div>

            {/*
              DURABLE VERIFICATION — the two claims no incumbent can make.
              Rejected claims: nobody else publishes a rejection rate because nobody else
              checks whether the "after" photo is the same place. Spots watched: a closed
              case that quietly refilled was never resolved, and a resolution rate that
              ignores that is the self-congratulatory number every civic app already prints.
              Deliberately shows 0 refilled when that is the truth rather than inventing one.
            */}
            {stats && stats.claims_total > 0 && (
              <div className="mt-3.5 grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  <div className="text-base font-medium leading-none tabular-nums text-white/90">
                    {stats.claims_rejected}
                    <span className="text-white/40"> / {stats.claims_total}</span>
                  </div>
                  <div className="mt-1 text-[11px] leading-tight text-white/60">
                    {t("claims_rejected")}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  <div className="text-base font-medium leading-none tabular-nums text-white/90">
                    {stats.spots_refilled}
                    <span className="text-white/40"> / {stats.spots_watched}</span>
                  </div>
                  <div className="mt-1 text-[11px] leading-tight text-white/60">
                    {t("spots_refilled")}
                  </div>
                </div>
                <p className="col-span-2 -mt-0.5 text-[11px] leading-relaxed text-white/45">
                  {t("durability_note")}
                </p>

                {/*
                  Entry to the sponsor evidence pack — a different audience's surface, so a
                  plain anchor (hard navigation) rather than next/link. Targets the currently
                  filtered ward when one is chosen, else the ward with the most REJECTED
                  claims: that page leads with its rejection log, and picking the busiest ward
                  instead would often open one whose hero section is empty.
                */}
                {(ward ?? stats.top_rejection_ward) && (
                  <a
                    href={`/impact/${ward ?? stats.top_rejection_ward}`}
                    className="col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[12px] text-white/70 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/[0.08] hover:text-white active:scale-[0.99]"
                  >
                    {t("sponsor_pack")}
                    <span aria-hidden="true">→</span>
                  </a>
                )}
              </div>
            )}

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
                // Fixed 90px so this column matches Wards and filter exactly, instead
                // of sizing to its own content and landing 2px wide of them.
                <div className="w-[90px] shrink-0">
                  <Segmented
                    options={[
                      { value: "3d", label: t("dim_3d") },
                      { value: "2d", label: t("dim_2d") },
                    ]}
                    value={mapMode}
                    onChange={(v) => setMapMode(v as MapMode)}
                    grow
                  />
                </div>
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
                <kbd className="ml-auto hidden shrink-0 rounded border border-white/15 px-1.5 py-0.5 font-sans text-[10px] text-white/60 sm:block">
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

            {/*
              GRID SYMMETRY. Measured at 393px, the two rows above this one are both
              [bordered wide control ending x=258/260] + [8px gap] + [~90px control
              ending x=358]. This row broke the pattern twice: the legend was bare text
              where its neighbours have bordered containers, and the filter button was
              70px against their 90px — so it read as a stray pill dropped onto a line of
              text. The legend now sits in a matching container and the button matches
              its column width, giving all three rows one grid.
            */}
            <div className="mt-3 flex items-center gap-2">
              {/*
                This row is now the map's colour KEY, not just two counts.
                Red/amber/green carried the entire status model and were explained
                nowhere — you had to infer that a green pillar meant verified. Adding
                the third swatch costs one item and turns an incidental stat strip into
                the legend, which is why it lives next to the map rather than in a
                separate panel nobody would open.
              */}
              <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[11px] text-white/60">
                <Dot colour="#ff3b30" label={`${stats?.open ?? 0} ${t("open_count")}`} />
                <Dot colour="#ffb020" label={`${stats?.claimed ?? 0} ${t("held_count")}`} />
                <Dot
                  colour="#22c98a"
                  label={`${stats?.verified ?? 0} ${t("verified_short")}`}
                />
              </div>
              {/*
                Was bare lowercase text with no border — indistinguishable from a label,
                so the filters behind it were effectively undiscoverable. Now a real
                control with a chevron that states its own direction, and it reports how
                many filters are active so "why am I seeing so few pins?" is answerable
                without opening it.
              */}
              <button
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
                className="flex h-11 w-[90px] shrink-0 items-center justify-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] text-[11px] font-medium text-white/75 transition-colors duration-300 hover:text-white active:bg-white/10"
              >
                {showFilters ? t("hide") : t("filter")}
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-[#3f8cff]/25 px-1.5 text-[10px] tabular-nums text-[#9dc8ff]">
                    {activeFilterCount}
                  </span>
                )}
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden
                  className={`transition-transform duration-300 ${showFilters ? "rotate-180" : ""}`}
                >
                  <path
                    d="M2.5 4.5L6 8l3.5-3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
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
      {/*
        Scroll-edge fade for the list. Rows pass UNDER the floating CTA by design —
        measured, the last row still clears it by 82px at full scroll, so nothing is
        unreachable — but they were being hard-cut by the pill's edge. A short gradient
        lets content dissolve into the chrome instead of colliding with it.
      */}
      {view === "list" && (
        <div
          className={`pointer-events-none absolute bottom-0 left-0 z-10 h-32 bg-gradient-to-t from-[#070a0f] via-[#070a0f]/80 to-transparent ${
            wide ? "w-[440px]" : "right-0"
          }`}
        />
      )}

      <div className="absolute bottom-0 left-0 right-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:right-auto lg:w-[440px]">
        {/*
          Name the outlined locality, and say WHICH KIND of shape it is. OSM has a
          surveyed boundary for only 5 of the 12 localities; the rest fall back to a hull
          of their own reports. Solid vs dashed here matches the map exactly, so the two
          can never be confused for one another.
        */}
        {/*
          Just the locality name. This used to read "Koramangala / Case cluster — no
          official boundary in OpenStreetMap": a sentence about where our geometry came
          from, floating over the map, aimed at nobody. Someone who taps a locality wants
          to know which one they tapped. The outline itself still renders solid or dashed,
          so the distinction is preserved for anyone who cares, without narrating it.
        */}
        {view === "map" && activeWard && (
          <div className="pointer-events-none mx-auto mb-2.5 flex w-fit max-w-full items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 backdrop-blur-xl">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{
                border: `1.5px ${
                  activeWard.kind === "official" ? "solid" : "dashed"
                } ${activeWard.kind === "official" ? "#6cb6ff" : "#93a4b8"}`,
              }}
            />
            <span className="truncate text-[12px] font-medium text-white/90">
              {activeWard.name}
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

/**
 * Position spring. bounce: 0 is not timidity — it is the requirement. Any overshoot on
 * POSITION drives the thumb into the track's 4px padding and through its border, which
 * is the one thing this must never do. Energy comes from the stretch below instead.
 */
const SEG_SPRING = { type: "spring" as const, bounce: 0, duration: 0.32 };
/** How long the thumb stays stretched. Short enough to read as momentum, not wobble. */
const SEG_STRETCH_MS = 170;

/**
 * Segmented control with a thumb that travels.
 *
 * WHAT WAS WRONG: `bg-white` was a class that hopped between buttons, cross-faded by
 * `transition-colors`. Nothing moved — mid-transition BOTH options were part-white, so
 * it read as "disappear here, appear there".
 *
 * WHAT IT IS NOW: one element, rendered only under the active option but tagged with a
 * stable layoutId. Motion measures its old and new boxes and interpolates between them,
 * so the thumb genuinely slides.
 *
 * Two structural details this depends on:
 *  - The layoutId is per-INSTANCE (useId). Three of these are mounted at once (language,
 *    Map/List, 3D/2D); a shared id would make switching language fling the thumb
 *    sideways into the 3D/2D control.
 *  - Motion owns the transform on the outer span (that is how layout animation works),
 *    so the squash lives on a SEPARATE inner span. Setting both on one element would
 *    have the two fight for the same property.
 */
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
  const uid = useId();
  const reduce = useReducedMotion();
  const [stretching, setStretching] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    if (reduce) return;
    setStretching(true);
    const t = window.setTimeout(() => setStretching(false), SEG_STRETCH_MS);
    return () => window.clearTimeout(t);
  }, [value, reduce]);

  return (
    <div
      className={`flex h-11 items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1 ${grow ? "flex-1" : ""}`}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`group relative h-full rounded-full px-3 text-xs font-medium ${
              grow ? "flex-1" : ""
            }`}
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId={`seg-thumb-${uid}`}
                transition={reduce ? { duration: 0 } : SEG_SPRING}
                className="absolute inset-0 rounded-full"
              >
                {/*
                  Squash-and-stretch. The thumb elongates along its direction of travel
                  and relaxes on arrival — the "blob" read — while its position never
                  passes the target. transform only, so it stays on the GPU.
                */}
                <span
                  className="block h-full w-full rounded-full bg-white"
                  style={{
                    transform: stretching ? "scaleX(1.07)" : "scaleX(1)",
                    transition: `transform ${SEG_STRETCH_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`,
                  }}
                />
              </motion.span>
            )}
            {/* Label rides above the thumb, and recolours as the thumb arrives. */}
            <span
              className={`relative z-10 transition-colors duration-200 ${
                active ? "text-black" : "text-white/60 group-hover:text-white/85"
              }`}
            >
              {o.label}
            </span>
          </button>
        );
      })}
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
