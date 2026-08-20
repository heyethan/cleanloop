"use client";

/**
 * CleanLoop 3D map — MapLibre GL, tilted camera, extruded severity pillars.
 *
 * Importers/callers: src/app/page.tsx (via next/dynamic, ssr:false).
 * Affected API: exports Map3D (default), MapHandle (imperative ref type),
 * STATUS_COLOUR.
 * Data schemas: consumes Report[] from src/lib/types.ts and the GeoJSON from
 * GET /api/facilities. created_at is ISO-8601 but unused here.
 * User instruction, verbatim: "can we make it 3d location using either (or all)
 * motion.dev/three.js/animation.js/gsap"
 *
 * TWO LAYERS OF 3D:
 *
 * 1. Buildings — the Liberty style already ships a `building-3d` fill-extrusion layer
 *    (minzoom 14) driven by OpenMapTiles' `render_height`. Those heights are
 *    APPROXIMATIONS derived from levels/height tags with fallbacks, not survey data.
 *    (Raw OSM only tags ~0.9% of Bengaluru buildings with a height — 22 of 2,426 in a
 *    Koramangala sample — so the vector tiles are doing the approximating, not us.)
 *
 * 2. Report pillars — the actual data story, and the differentiator. Each report is
 *    extruded with HEIGHT = severity and COLOUR = status, drawn above the buildings so
 *    a severe open dump is unmistakable from across the city.
 */

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
// MapLibre v6 has no default export — these are all named exports.
import {
  Map as MLMap,
  AttributionControl,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import type { Report, ReportStatus } from "@/lib/types";

/**
 * REQUIRED, and the reason this map was blank for its entire first life.
 *
 * MapLibre v6 is ESM-only and loads its worker as a real URL. Turbopack does not emit
 * that worker, so it never spawns: no tiles are ever requested, `isStyleLoaded()` never
 * turns true, the `load` event never fires, and the map paints the style's default
 * background and nothing else — with no console error at all (maplibre-gl-js#8024).
 *
 * scripts/copy-maplibre-worker.mjs puts the worker (and the shared chunk it imports by
 * relative path) in public/maplibre/ via the predev/prebuild hooks. Self-hosted rather
 * than a CDN so the demo has no extra external dependency on venue wifi.
 *
 * Module scope on purpose: this must run before any `new MLMap(...)`.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/** Keyless vector tiles — verified reachable, no API key, no signup friction. */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const BENGALURU: [number, number] = [77.5946, 12.9716];

/**
 * This is a Bengaluru product, so the map is locked to Bengaluru. Panning off to the
 * Atlantic is not a feature — it just lets a demo get lost and loads tiles nobody needs.
 * Slightly padded around the city so the edges don't feel walled-in.
 * [[west, south], [east, north]]
 */
const BENGALURU_BOUNDS: [[number, number], [number, number]] = [
  [77.35, 12.75],
  [77.9, 13.2],
];

/** Below this the city stops filling the frame and you're looking at empty state. */
const MIN_ZOOM = 10;

export const STATUS_COLOUR: Record<ReportStatus, string> = {
  open: "#ff3b30",
  claimed: "#ffb020",
  verified_resolved: "#22c98a",
};

/** Metres of pillar per severity point. Severity 5 -> 500m: readable when tilted. */
const HEIGHT_PER_SEVERITY = 100;

/**
 * MapLibre's fill-extrusion needs polygons, so each report becomes a small square
 * footprint. ~18m at Bengaluru's latitude — big enough to see when pitched, small
 * enough that dense clusters stay legible.
 */
function squareAround(lng: number, lat: number, metres = 18): number[][] {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
}

function reportsToGeoJSON(reports: Report[]) {
  return {
    type: "FeatureCollection" as const,
    features: reports.map((r) => ({
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [squareAround(r.lng, r.lat)],
      },
      properties: {
        id: r.id,
        status: r.status,
        severity: r.severity,
        waste_type: r.waste_type,
        is_recurring: r.is_recurring,
        height: r.severity * HEIGHT_PER_SEVERITY,
        colour: STATUS_COLOUR[r.status],
      },
    })),
  };
}

export interface MapHandle {
  /** Cinematic fly to a report — used for the peak moment when a pin verifies. */
  flyToReport: (r: Report, opts?: { zoom?: number }) => void;
  resetView: () => void;
}

interface Props {
  reports: Report[];
  onSelect: (r: Report) => void;
  showFacilities: boolean;
}

/**
 * MapLibre throws GPUInitializationError when WebGL2 is missing, which leaves a
 * blank void where the product should be. Locked-down browsers, remote-desktop
 * sessions and headless Chromium all hit this. Detect it and degrade to a usable
 * list instead of failing silently on stage.
 */
function supportsWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2"));
  } catch {
    return false;
  }
}

const Map3D = forwardRef<MapHandle, Props>(function Map3D(
  { reports, onSelect, showFacilities },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);
  const reportsRef = useRef<Report[]>(reports);
  reportsRef.current = reports;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useImperativeHandle(ref, () => ({
    flyToReport(r, opts) {
      map.current?.easeTo({
        center: [r.lng, r.lat],
        zoom: opts?.zoom ?? 16.5,
        pitch: 62,
        bearing: -22,
        duration: 1600,
        // Heavy, weighted deceleration — matches the motion language of the sheets.
        easing: (t) => 1 - Math.pow(1 - t, 4),
      });
    },
    resetView() {
      map.current?.easeTo({
        center: BENGALURU,
        zoom: 11.4,
        pitch: 50,
        bearing: -18,
        duration: 1400,
        easing: (t) => 1 - Math.pow(1 - t, 4),
      });
    },
  }));

  // --- init -----------------------------------------------------------------
  useEffect(() => {
    if (!container.current || map.current) return;
    if (!supportsWebGL2()) {
      setWebglFailed(true);
      return;
    }

    let m: MLMap;
    try {
      m = new MLMap({
        container: container.current,
        style: STYLE_URL,
        center: BENGALURU,
        zoom: 11.4,
        pitch: 50,
        bearing: -18,
        maxBounds: BENGALURU_BOUNDS,
        minZoom: MIN_ZOOM,
        attributionControl: false,
      });
    } catch {
      setWebglFailed(true);
      return;
    }
    map.current = m;

    /*
     * MapLibre swallows some failures (notably worker load errors — see
     * maplibre-gl-js#8024), which is exactly how this map shipped blank once. Surface
     * them rather than letting the map fail silently again.
     */
    m.on("error", (e) => {
      console.error("[maplibre]", (e as unknown as { error?: Error }).error ?? e);
    });

    // Dev-only inspection handle for browser QA. Never present in a production bundle.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __map?: MLMap }).__map = m;
    }

    m.addControl(
      new AttributionControl({ compact: true }),
      "bottom-right",
    );
    m.addControl(
      new NavigationControl({ visualizePitch: true }),
      "bottom-right",
    );

    m.on("load", () => {
      // Dark-ify the vector style so the data reads as the bright layer, not the map.
      for (const layer of m.getStyle().layers ?? []) {
        try {
          if (layer.type === "background") {
            m.setPaintProperty(layer.id, "background-color", "#0a0d12");
          } else if (layer.type === "fill-extrusion") {
            // Liberty ships a `building-3d` extrusion layer (minzoom 14) driven by
            // OpenMapTiles' render_height. It defaults to a light cream, which reads as
            // white blocks on a dark map — darken it so buildings become city mass and
            // the report pillars stay the brightest thing on screen.
            m.setPaintProperty(layer.id, "fill-extrusion-color", "#161c26");
            m.setPaintProperty(layer.id, "fill-extrusion-opacity", 0.9);
          } else if (layer.type === "fill" && /water/.test(layer.id)) {
            m.setPaintProperty(layer.id, "fill-color", "#0d1622");
          } else if (
            layer.type === "fill" &&
            /land|earth|park|wood|grass|residential/.test(layer.id)
          ) {
            m.setPaintProperty(layer.id, "fill-color", "#0f141b");
          } else if (
            layer.type === "line" &&
            /road|street|motorway|transport|bridge/.test(layer.id)
          ) {
            m.setPaintProperty(layer.id, "line-color", "#232c38");
          } else if (layer.type === "symbol") {
            m.setPaintProperty(layer.id, "text-color", "#7c8899");
            m.setPaintProperty(layer.id, "text-halo-color", "#05070a");
          }
        } catch {
          /* some layers reject paint overrides; skipping one is harmless */
        }
      }

      // --- real OSM waste infrastructure (genuine data layer) ---------------
      m.addSource("facilities", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "facilities-dots",
        type: "circle",
        source: "facilities",
        layout: { visibility: showFacilities ? "visible" : "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 16, 4.5],
          "circle-color": "#3f8cff",
          "circle-opacity": 0.55,
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "#8ab6ff",
        },
      });

      // --- report pillars ---------------------------------------------------
      m.addSource("reports", {
        type: "geojson",
        data: reportsToGeoJSON(reportsRef.current),
      });

      // Ground glow first so pillars draw on top of it.
      m.addLayer({
        id: "report-glow",
        type: "circle",
        source: "reports",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            ["*", ["get", "severity"], 1.6],
            16,
            ["*", ["get", "severity"], 6],
          ],
          "circle-color": ["get", "colour"],
          "circle-opacity": 0.18,
          "circle-blur": 1,
        },
      });

      m.addLayer({
        id: "report-pillars",
        type: "fill-extrusion",
        source: "reports",
        paint: {
          "fill-extrusion-color": ["get", "colour"],
          "fill-extrusion-base": 0,
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-opacity": 0.82,
        },
      });

      m.on("click", "report-pillars", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (!id) return;
        const found = reportsRef.current.find((r) => r.id === id);
        if (found) onSelectRef.current(found);
      });
      m.on("mouseenter", "report-pillars", () => {
        m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", "report-pillars", () => {
        m.getCanvas().style.cursor = "";
      });

      setReady(true);
    });

    return () => {
      m.remove();
      map.current = null;
    };
    // Map initialises exactly once; live values are read through refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- keep pillars in sync -------------------------------------------------
  useEffect(() => {
    if (!ready || !map.current) return;
    const src = map.current.getSource("reports") as GeoJSONSource | undefined;
    src?.setData(reportsToGeoJSON(reports) as never);
  }, [reports, ready]);

  // --- real facilities layer ------------------------------------------------
  useEffect(() => {
    if (!ready || !map.current) return;
    const m = map.current;
    m.setLayoutProperty(
      "facilities-dots",
      "visibility",
      showFacilities ? "visible" : "none",
    );
    if (!showFacilities) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/facilities");
        const gj = await res.json();
        if (!alive || gj.error) return;
        const src = m.getSource("facilities") as GeoJSONSource | undefined;
        src?.setData(gj);
      } catch {
        /* real-data layer is additive; failing to load it must not break the map */
      }
    })();
    return () => {
      alive = false;
    };
  }, [showFacilities, ready]);

  // Graceful degradation: the product still works without a GPU, it just isn't 3D.
  if (webglFailed) {
    return (
      <div className="h-full w-full overflow-y-auto bg-[#070a0f] px-3 pb-40 pt-52">
        <div className="mx-auto max-w-md">
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-200">
            3D map unavailable — this browser has no WebGL2. Showing the report list
            instead; everything else works normally.
          </div>
          <ul className="mt-3 space-y-2">
            {reports.slice(0, 60).map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => onSelect(r)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left transition-colors active:bg-white/[0.08]"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: STATUS_COLOUR[r.status],
                      boxShadow: `0 0 10px ${STATUS_COLOUR[r.status]}`,
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm capitalize text-white/90">
                      {r.waste_type} · severity {r.severity}/5
                    </span>
                    <span className="block truncate text-[11px] text-white/55">
                      {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return <div ref={container} className="h-full w-full" />;
});

export default Map3D;
