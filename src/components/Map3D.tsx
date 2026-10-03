"use client";

/**
 * CleanLoop 3D map — MapLibre GL, tilted camera, extruded severity pillars.
 *
 * Importers/callers: src/app/page.tsx (via next/dynamic, ssr:false).
 * Affected API: exports Map3D (default), MapHandle (imperative ref type),
 * STATUS_COLOUR.
 * Data schemas: consumes Pin[] and Areas from src/lib/types.ts (GET /api/reports, GET /api/areas),
 * and the GeoJSON from GET /api/facilities and GET /api/roads. created_at is unused here.
 *
 * AREAS: below zoom 12.5 the 10 GBA zones are the hover/tap targets; from 12.5 up, the 369
 * wards. Click priority is pins, then roads (popup), then areas.
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

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
// MapLibre v6 has no default export — these are all named exports.
import {
  Map as MLMap,
  AttributionControl,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import type { AreaPick, Areas, Pin, ReportStatus, WardArea, ZoneArea } from "@/lib/types";
import { initials } from "@/components/Face";

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
 * Bengaluru's actual extent, from OpenStreetMap Nominatim: 34 x 35 km
 * (lat 12.8335..13.1426, lng 77.4599..77.7841). Padded by ~0.03 deg so the edges of
 * the city don't sit flush against a wall.
 *
 * [[west, south], [east, north]]
 */
const BENGALURU_BOUNDS: [[number, number], [number, number]] = [
  [77.43, 12.8],
  [77.81, 13.17],
];

/**
 * NOTE: maxBounds constrains PANNING, not what the camera can see. On a wide window
 * the horizon still spilled into neighbouring districts (Tumakuru, ~70km away, showed
 * up in a desktop screenshot).
 *
 * Measured on an 1850px-wide viewport, visible width by camera pitch:
 *   pitch 50 -> 68km | pitch 35 -> 54km | pitch 20 -> 47km | pitch 0 -> 41km
 * Bengaluru itself is ~35km across, so PITCH is the dominant cause of spill, not zoom.
 * 35 degrees keeps the 3D read while roughly halving how far past the city you can see.
 */
const MIN_ZOOM = 10.5;

/** City overview tilt. Street-level fly-ins use a steeper angle where spill is moot. */
const OVERVIEW_PITCH = 35;

/*
 * ---------------------------------------------------------------- locality flight
 * Tuning constants for the Cmd-K locality flight. Grouped and named so this is a
 * one-line change to iterate on, which is what was asked for.
 */

/**
 * How much wider than the city itself the opening frame is allowed to be.
 * 1.0 would crop the city edges; a little slack keeps all of Bengaluru on screen
 * while cutting the surrounding districts out of the shot.
 */
const MAX_SPILL = 1.08;

/**
 * Trim horizontal spill after a fitBounds.
 *
 * fitBounds CONTAINS a box: it picks the zoom that fits both axes, so the
 * non-constraining axis over-reveals. On a 1440x900 window the height binds, and the
 * opening frame showed Hoskote, Nelamangala and Doddaballapur — towns 30-40km outside
 * Bengaluru — purely as horizontal spill.
 *
 * This is MEASURED, not derived. The obvious closed form (Web Mercator: zoom where
 * spanLng fills widthPx) is wrong here because the camera is pitched: at pitch 35 that
 * formula produced 25.9km of visible width against a 41.2km city, cropping a third of
 * Bengaluru. Reading the map's own reported bounds and correcting by the observed ratio
 * sidesteps having to model the tilted frustum at all.
 *
 * Only ever zooms IN, so a viewport that already frames the city tightly is untouched.
 */
function trimSpill(m: MLMap) {
  const target = (BENGALURU_BOUNDS[1][0] - BENGALURU_BOUNDS[0][0]) * MAX_SPILL;
  for (let pass = 0; pass < 2; pass++) {
    const b = m.getBounds();
    const shown = b.getEast() - b.getWest();
    if (shown <= target) return;
    m.setZoom(m.getZoom() + Math.log2(shown / target));
  }
}

/** Zoom the camera settles at when arriving in a locality. */
const WARD_ZOOM = 14.2;
/** Camera tilt on arrival — steeper than the city overview so pillars read as height. */
const WARD_PITCH = 55;
/** Travel time to the locality. */
const WARD_FLY_MS = 2000;
/**
 * Degrees of bearing swept after arrival. A SETTLING arc, not an endless spin: an
 * infinite orbit fights the user's own input, drains the phone, and breaks the
 * interruptibility rule (an animation must always be grabbable and reversible).
 */
const ORBIT_ARC_DEG = 55;
/** Duration of that arc. */
const ORBIT_MS = 5200;
/** How long the pillars take to extrude from flat to full height on arrival. */
const PILLAR_GROW_MS = 1100;

export const STATUS_COLOUR: Record<ReportStatus, string> = {
  open: "#ff3b30",
  claimed: "#ffb020",
  // Cleaned and verified, waiting on the reporter: paler than the closed green.
  awaiting_confirmation: "#8fe3bf",
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

/** Zones below this zoom, wards at and above it. */
const WARD_MIN_ZOOM = 12.5;
/** Below this zoom only severity 4-5 pillars extrude; the ground glow still shows every case. */
const PILLAR_ALL_ZOOM = 12;

/** prefers-reduced-motion: no orbit, no camera flights — cuts straight to the destination. */
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Phones get a still camera: no settling orbit after a fly-in. */
const isPhone = () => typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches;

function reportsToGeoJSON(reports: Pin[]) {
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
        overdue: r.overdue,
        height: r.severity * HEIGHT_PER_SEVERITY,
        colour: STATUS_COLOUR[r.status],
      },
    })),
  };
}

export interface MapHandle {
  /** Cinematic fly to a report — used for the peak moment when a pin verifies. */
  flyToReport: (r: { lat: number; lng: number }, opts?: { zoom?: number }) => void;
  /** Frame a zone or ward, highlight it, and (3D, desktop) settle into a short orbit. */
  flyToArea: (a: AreaPick) => void;
  /**
   * Frame several zones at once (an official's whole area) and drop a teardrop marker with
   * their face at the centre. clearMarker() removes it.
   */
  showOfficial: (zones: AreaPick[], face: { name: string; photo_url: string | null }) => void;
  clearMarker: () => void;
  resetView: () => void;
}

export type MapMode = "2d" | "3d";

interface Props {
  reports: Pin[];
  onSelect: (r: Pin) => void;
  /** GET /api/areas; the area layers fill in when it arrives. */
  areas: Areas | null;
  showFacilities: boolean;
  /** 2D = flat top-down with circle markers; 3D = tilted with extruded pillars. */
  mode: MapMode;
  /** The zone or ward under the pointer (or last tapped), so the UI can name it. */
  onActiveArea?: (a: AreaPick | null) => void;
  /**
   * A click on an area. Desktop flies there itself; on a phone the parent shows a card with
   * "Zoom in" instead, so `flyOnClick` is false there.
   */
  onTapArea?: (a: AreaPick | null) => void;
  flyOnClick?: boolean;
  /**
   * Fires once MapLibre has its style and first tiles painted.
   *
   * next/dynamic's `loading:` fallback only covers fetching this component's JS chunk.
   * After that resolves the map still has to pull a style and tiles, and the user stares
   * at an empty dark box for that second stretch. The parent needs this signal to hold a
   * loader over the real gap.
   */
  onReady?: () => void;
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

function areaPickOf(kind: "zone" | "ward", p: WardArea | ZoneArea, bbox: [number, number, number, number]): AreaPick {
  return kind === "ward"
    ? { kind, id: (p as WardArea).id, name: (p as WardArea).name, name_kn: (p as WardArea).name_kn, zone: p.zone, corporation: p.corporation, open: p.open, overdue: p.overdue, bbox }
    : { kind, id: p.zone, name: p.zone, name_kn: null, zone: p.zone, corporation: p.corporation, open: p.open, overdue: p.overdue, bbox };
}

/** Bounding box of a rendered (tile-clipped) ward polygon is wrong; use the source data instead. */
function wardBbox(areas: Areas | null, id: string): [number, number, number, number] | null {
  const f = areas?.wards.features.find((w) => w.properties.id === id);
  if (!f) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of f.geometry.coordinates)
    for (const [x, y] of poly[0]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  return [minX, minY, maxX, maxY];
}

const Map3D = forwardRef<MapHandle, Props>(function Map3D(
  { reports, onSelect, areas, showFacilities, mode, onActiveArea, onTapArea, flyOnClick = true, onReady },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);
  const reportsRef = useRef<Pin[]>(reports);
  reportsRef.current = reports;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onActiveAreaRef = useRef(onActiveArea);
  onActiveAreaRef.current = onActiveArea;
  const onTapAreaRef = useRef(onTapArea);
  onTapAreaRef.current = onTapArea;
  const flyOnClickRef = useRef(flyOnClick);
  flyOnClickRef.current = flyOnClick;
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const marker = useRef<Marker | null>(null);
  const popup = useRef<Popup | null>(null);
  // Same ref pattern: the map initialises once, so a captured callback would go stale.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  /** Area currently painted as active: a zone name or a ward id. */
  const active = useRef<{ kind: "zone" | "ward"; id: string } | null>(null);
  /** True after a click, search pick or official pick: hover stops repainting the highlight. */
  const pinned = useRef(false);
  /** Handles for the two rAF loops, so a new flight (or a touch) can cancel them. */
  const orbitRaf = useRef<number | null>(null);
  const growRaf = useRef<number | null>(null);

  const stopOrbit = useCallback(() => {
    if (orbitRaf.current !== null) {
      cancelAnimationFrame(orbitRaf.current);
      orbitRaf.current = null;
    }
  }, []);

  /**
   * Paint one area as active and clear whatever was active before. Wards use feature state
   * (promoteId "id"); a zone is many ward polygons, so it is a paint expression on its name.
   */
  const setActiveArea = useCallback((pick: AreaPick | null, notify = true) => {
    const m = map.current;
    if (!m || !m.getSource("wards")) return;
    const prev = active.current;
    if (prev?.kind === pick?.kind && prev?.id === pick?.id) return;
    if (prev?.kind === "ward") m.setFeatureState({ source: "wards", id: prev.id }, { active: false });
    active.current = pick && { kind: pick.kind, id: pick.id };
    if (pick?.kind === "ward") m.setFeatureState({ source: "wards", id: pick.id }, { active: true });
    const zone = pick?.kind === "zone" ? pick.id : "";
    m.setPaintProperty("zone-fill", "fill-opacity", ["case", ["==", ["get", "zone"], zone], 0.14, 0]);
    m.setPaintProperty("zone-line", "line-opacity", ["case", ["==", ["get", "zone"], zone], 0.95, 0.55]);
    m.setPaintProperty("zone-line", "line-width", ["case", ["==", ["get", "zone"], zone], 2.4, 1.2]);
    if (notify) onActiveAreaRef.current?.(pick);
  }, []);

  /**
   * Extrude the pillars from flat to their real height.
   *
   * Driven by rAF rather than a MapLibre paint transition: `fill-extrusion-height` here
   * is a DATA-DRIVEN expression (`["get","height"]`), and MapLibre does not interpolate
   * transitions on data-driven paint properties — setting `-transition` would silently do
   * nothing. Multiplying the expression by a scalar each frame is ~120 features on one
   * uniform, which is cheap for a one-second animation.
   */
  const growPillars = useCallback(() => {
    const m = map.current;
    if (!m || !m.getLayer("report-pillars")) return;
    if (growRaf.current !== null) cancelAnimationFrame(growRaf.current);

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / PILLAR_GROW_MS);
      // Ease-out-quart, the same deceleration curve the camera and sheets use.
      const eased = 1 - Math.pow(1 - t, 4);
      try {
        m.setPaintProperty("report-pillars", "fill-extrusion-height", [
          "*",
          ["get", "height"],
          Math.max(0.001, eased),
        ]);
      } catch {
        /* layer can vanish mid-animation on a style change; stopping is correct */
        return;
      }
      if (t < 1) growRaf.current = requestAnimationFrame(tick);
      else growRaf.current = null;
    };
    growRaf.current = requestAnimationFrame(tick);
  }, []);

  /** Frame a bbox; 3D desktop flights extrude the pillars and settle into a short orbit. */
  const frame = useCallback(
    (bbox: [number, number, number, number], maxZoom: number) => {
      const m = map.current;
      if (!m) return;
      stopOrbit();
      const is3d = modeRef.current === "3d";
      const still = reducedMotion();
      /*
       * Fit the area FLAT, then zoom in a step when pitched. fitBounds with pitch frames the
       * tilted frustum, which over-reveals the far side — an area landed small in the middle of
       * a wide view. Solving at pitch 0 and adding a pitch boost fills the viewport with the
       * area; maxZoom stops a tiny ward from landing at street level.
       */
      const pitch = is3d ? (isPhone() ? 45 : WARD_PITCH) : 0;
      const cam = m.cameraForBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        {
          padding: isPhone()
            ? { top: 140, bottom: 260, left: 20, right: 20 }
            : { top: 60, bottom: 60, left: 470, right: 100 },
          bearing: m.getBearing(),
        },
      );
      const zoom = Math.min(maxZoom, (cam?.zoom ?? m.getZoom()) + (pitch ? 0.45 : 0.15));
      m.flyTo({
        center: cam?.center ?? m.getCenter(),
        zoom,
        pitch,
        bearing: m.getBearing(),
        duration: still ? 0 : WARD_FLY_MS,
        easing: (t) => 1 - Math.pow(1 - t, 4),
        essential: true,
      });
      // Pillars extrude as the camera lands, so the two motions read as one arrival.
      if (is3d && !still) window.setTimeout(growPillars, WARD_FLY_MS * 0.55);

      /*
       * Then a slow settling orbit. Driven by rAF and easeTo-free so it can be abandoned
       * on the exact frame the user touches the map — an animation the user cannot grab
       * and stop is the thing Apple's fluid-interface guidance warns against.
       * Skipped on phones and under reduced motion.
       */
      if (!is3d || still || isPhone()) return;
      window.setTimeout(() => {
        const begin = performance.now();
        const from = m.getBearing();
        const tick = (now: number) => {
          const t = Math.min(1, (now - begin) / ORBIT_MS);
          const eased = 1 - Math.pow(1 - t, 3);
          m.setBearing(from + ORBIT_ARC_DEG * eased);
          orbitRaf.current = t < 1 ? requestAnimationFrame(tick) : null;
        };
        orbitRaf.current = requestAnimationFrame(tick);
      }, WARD_FLY_MS);
    },
    [stopOrbit, growPillars],
  );

  useImperativeHandle(ref, () => ({
    flyToReport(r, opts) {
      map.current?.easeTo({
        center: [r.lng, r.lat],
        zoom: opts?.zoom ?? 16.5,
        // A tilted camera in 2D mode would defeat the point of choosing 2D.
        pitch: modeRef.current === "2d" ? 0 : isPhone() ? 45 : 62,
        bearing: modeRef.current === "2d" ? 0 : -22,
        duration: reducedMotion() ? 0 : 1600,
        // Heavy, weighted deceleration — matches the motion language of the sheets.
        easing: (t) => 1 - Math.pow(1 - t, 4),
      });
    },
    flyToArea(a) {
      pinned.current = true;
      setActiveArea(a);
      frame(a.bbox, a.kind === "ward" ? 16 : 14);
    },
    showOfficial(zones, face) {
      const m = map.current;
      if (!m || zones.length === 0) return;
      const bbox: [number, number, number, number] = [
        Math.min(...zones.map((z) => z.bbox[0])),
        Math.min(...zones.map((z) => z.bbox[1])),
        Math.max(...zones.map((z) => z.bbox[2])),
        Math.max(...zones.map((z) => z.bbox[3])),
      ];
      pinned.current = zones.length === 1;
      setActiveArea(zones.length === 1 ? zones[0] : null);
      frame(bbox, WARD_ZOOM - 1);

      // Teardrop pin with their face, at the centre of their area.
      marker.current?.remove();
      const el = document.createElement("div");
      el.className = "official-pin";
      el.setAttribute("aria-label", face.name);
      const disc = document.createElement("div");
      disc.className = "official-pin__face";
      disc.textContent = initials(face.name);
      if (face.photo_url) {
        const img = document.createElement("img");
        img.src = face.photo_url;
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.onerror = () => img.remove();
        disc.appendChild(img);
      }
      el.appendChild(disc);
      marker.current = new Marker({ element: el, anchor: "bottom" })
        .setLngLat(shapeCentre(areasRef.current?.wards.features ?? [], zones.map((z) => z.zone), bbox))
        .addTo(m);
    },
    clearMarker() {
      marker.current?.remove();
      marker.current = null;
    },
    resetView() {
      stopOrbit();
      pinned.current = false;
      setActiveArea(null);
      const m = map.current;
      if (!m) return;
      m.fitBounds(BENGALURU_BOUNDS, {
        padding: { top: 200, bottom: 90, left: 24, right: 24 },
        pitch: OVERVIEW_PITCH,
        bearing: -18,
        duration: reducedMotion() ? 0 : 1400,
      });
      // Same spill trim as the opening camera, applied once the flight has landed.
      m.once("moveend", () => trimSpill(m));
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
        pitch: OVERVIEW_PITCH,
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
      /*
       * Frame the city itself rather than trusting a hardcoded zoom. A fixed zoom that
       * looks right on a phone shows three neighbouring districts on a wide desktop
       * window. fitBounds solves for the viewport, so Bengaluru fills the screen at any
       * size. Padding is asymmetric: the header card occupies the top ~200px.
       */
      m.fitBounds(BENGALURU_BOUNDS, {
        padding: { top: 200, bottom: 90, left: 24, right: 24 },
        pitch: OVERVIEW_PITCH,
        bearing: -18,
        duration: 0,
      });
      // Then trim spill so a wide window doesn't reveal neighbouring districts.
      trimSpill(m);

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
          } else if (layer.type === "fill" && /building/.test(layer.id)) {
            // The flat building layer (below the 3D one's minzoom) is cream too: at zoom
            // ~13-14 it painted the city as white blocks. Same dark mass as the extrusions.
            m.setPaintProperty(layer.id, "fill-color", "#161c26");
            m.setPaintProperty(layer.id, "fill-outline-color", "#1c2430");
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

      /*
       * --- GBA zones and wards ------------------------------------------------
       * Added FIRST so every data layer draws above them: this is context, not content.
       * One polygon source (the 369 wards, promoteId "id" for feature state). Zones are
       * painted from the same polygons by zone name, plus their own precomputed outlines
       * (scripts/build-zones.ts). Data arrives from GET /api/areas in an effect below.
       */
      const empty = { type: "FeatureCollection" as const, features: [] };
      m.addSource("wards", { type: "geojson", data: areasRef.current?.wards ?? empty, promoteId: "id" });
      m.addSource("zones", { type: "geojson", data: areasRef.current?.zones ?? empty });

      m.addLayer({
        id: "zone-fill",
        type: "fill",
        source: "wards",
        maxzoom: WARD_MIN_ZOOM,
        // Only the active zone tints; the rest stay invisible (but still hit-testable).
        paint: { "fill-color": "#4da3ff", "fill-opacity": 0, "fill-opacity-transition": { duration: 280, delay: 0 } },
      });
      m.addLayer({
        id: "zone-line",
        type: "line",
        source: "zones",
        layout: { "line-join": "round" },
        paint: { "line-color": "#6cb6ff", "line-width": 1.2, "line-opacity": 0.55 },
      });
      m.addLayer({
        id: "ward-fill",
        type: "fill",
        source: "wards",
        minzoom: WARD_MIN_ZOOM,
        paint: {
          "fill-color": "#4da3ff",
          "fill-opacity": ["case", ["boolean", ["feature-state", "active"], false], 0.14, 0],
          "fill-opacity-transition": { duration: 280, delay: 0 },
        },
      });
      m.addLayer({
        id: "ward-line",
        type: "line",
        source: "wards",
        minzoom: WARD_MIN_ZOOM,
        layout: { "line-join": "round" },
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "active"], false], "#6cb6ff", "#93a4b8"],
          "line-width": ["case", ["boolean", ["feature-state", "active"], false], 2.2, 0.6],
          "line-opacity": ["case", ["boolean", ["feature-state", "active"], false], 0.95, 0.3],
        },
      });

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

      // --- live road quality (open data from /api/roads) --------------------
      // Only reported segments come back; poor = red, good = green, unknown = grey.
      m.addSource("roads", { type: "geojson", data: "/api/roads" });
      m.addLayer({
        id: "roads-quality",
        type: "line",
        source: "roads",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "quality"], "poor", "#ff5a4f", "good", "#22c98a", "#8a94a6"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 16, 6],
          "line-opacity": 0.85,
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
        layout: { visibility: mode === "3d" ? "visible" : "none" },
        paint: {
          "fill-extrusion-color": ["get", "colour"],
          "fill-extrusion-base": 0,
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-opacity": 0.82,
        },
      });

      /*
       * 2D counterpart. An extruded pillar viewed straight down is just a small square,
       * so flat mode gets proper scaled circles instead — severity reads as radius the
       * way it reads as height in 3D.
       */
      m.addLayer({
        id: "report-dots",
        type: "circle",
        source: "reports",
        layout: { visibility: mode === "2d" ? "visible" : "none" },
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            ["+", 3, ["*", ["get", "severity"], 0.9]],
            16,
            ["+", 6, ["*", ["get", "severity"], 3]],
          ],
          "circle-color": ["get", "colour"],
          "circle-opacity": 0.9,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#070a0f",
        },
      });

      /*
       * Overdue: a red ring at every zoom, and an "OVERDUE" tag once you are close enough to
       * read it. Imports never carry the flag (src/lib/areas.ts).
       */
      m.addLayer({
        id: "report-overdue-ring",
        type: "circle",
        source: "reports",
        filter: ["==", ["get", "overdue"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 14],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ff3b30",
          "circle-stroke-opacity": 0.85,
        },
      });
      m.addLayer({
        id: "report-overdue-tag",
        type: "symbol",
        source: "reports",
        minzoom: 14,
        filter: ["==", ["get", "overdue"], true],
        layout: {
          "text-field": "OVERDUE",
          "text-font": ["Noto Sans Bold"],
          "text-size": 10,
          "text-letter-spacing": 0.08,
          "text-offset": [0, 1.6],
          "text-allow-overlap": false,
        },
        paint: { "text-color": "#ffb0a5", "text-halo-color": "#3a0b08", "text-halo-width": 1.4 },
      });

      // Fewer extrusions at city scale: only the worst cases stand up until you zoom in.
      const syncPillars = () =>
        m.setFilter("report-pillars", m.getZoom() < PILLAR_ALL_ZOOM ? [">=", ["get", "severity"], 4] : null);
      syncPillars();
      m.on("zoomend", syncPillars);

      for (const layerId of ["report-pillars", "report-dots", "roads-quality"]) {
        m.on("mouseenter", layerId, () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", layerId, () => {
          m.getCanvas().style.cursor = "";
        });
      }

      /** The zone or ward at a point, depending on the zoom level. */
      const areaAt = (point: { x: number; y: number }): AreaPick | null => {
        const wardMode = m.getZoom() >= WARD_MIN_ZOOM;
        const f = m.queryRenderedFeatures([point.x, point.y], { layers: [wardMode ? "ward-fill" : "zone-fill"] })[0];
        if (!f) return null;
        const p = f.properties as WardArea;
        if (wardMode) return areaPickOf("ward", p, wardBbox(areasRef.current, p.id) ?? [0, 0, 0, 0]);
        const z = areasRef.current?.zones.features.find((x) => x.properties.zone === p.zone)?.properties;
        return z ? areaPickOf("zone", z, z.bbox) : null;
      };

      /*
       * Hover (desktop only — touch has no hover): name the area under the pointer. The
       * highlight follows hover until something is clicked; a click pins it.
       */
      m.on("mousemove", (e) => {
        if (pinned.current) return;
        setActiveArea(areaAt(e.point));
      });
      m.getCanvas().addEventListener("mouseleave", () => {
        if (!pinned.current) setActiveArea(null);
      });

      /*
       * One click handler, in priority order: a report pin, then a road (popup), then an
       * area. Separate per-layer handlers used to fire together, so a tap on a pin also
       * selected the area underneath it.
       */
      m.on("click", (e) => {
        const pinLayers = ["report-pillars", "report-dots"].filter(
          (l) => m.getLayer(l) && m.getLayoutProperty(l, "visibility") !== "none",
        );
        const pin = m.queryRenderedFeatures(e.point, { layers: pinLayers })[0];
        if (pin) {
          const found = reportsRef.current.find((r) => r.id === pin.properties?.id);
          if (found) onSelectRef.current(found);
          return;
        }

        const road = m.queryRenderedFeatures(e.point, { layers: ["roads-quality"] })[0];
        if (road) {
          const p = road.properties as { name?: string; quality: string; reports: number; open: number };
          const quality = p.quality === "poor" ? "Poor" : p.quality === "good" ? "Good" : "Unrated";
          const box = document.createElement("div");
          box.className = "road-pop";
          const title = document.createElement("strong");
          title.textContent = p.name || "Unnamed road";
          const line = document.createElement("div");
          line.textContent = `Quality: ${quality} · ${p.reports} report${p.reports === 1 ? "" : "s"}${p.open ? ` (${p.open} open)` : ""}`;
          box.append(title, line);
          popup.current?.remove();
          popup.current = new Popup({ closeButton: true, maxWidth: "240px", className: "road-popup" })
            .setLngLat(e.lngLat)
            .setDOMContent(box)
            .addTo(m);
          return;
        }

        const area = areaAt(e.point);
        pinned.current = area !== null;
        setActiveArea(area);
        onTapAreaRef.current?.(area);
        if (area && flyOnClickRef.current) {
          frame(area.bbox, area.kind === "ward" ? 16 : 14);
        }
      });

      // Exploring again (pan or zoom by hand) hands the highlight back to hover.
      for (const ev of ["dragstart", "wheel"] as const) m.on(ev, () => (pinned.current = false));

      // Any hand on the map wins over the orbit, immediately.
      for (const ev of ["dragstart", "touchstart", "wheel", "mousedown"] as const) {
        m.on(ev, stopOrbit);
      }
      // The zoom/compass buttons live outside the canvas, so mousedown above never sees them;
      // a user-started move carries originalEvent, the orbit's own setBearing does not.
      m.on("movestart", (e) => {
        if ((e as { originalEvent?: Event }).originalEvent) stopOrbit();
      });

      setReady(true);
      onReadyRef.current?.();
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

  // --- areas arrive after the map does ------------------------------------
  useEffect(() => {
    if (!ready || !map.current || !areas) return;
    const m = map.current;
    (m.getSource("wards") as GeoJSONSource | undefined)?.setData(areas.wards as never);
    (m.getSource("zones") as GeoJSONSource | undefined)?.setData(areas.zones as never);
    // setData resets feature state; re-apply the active ward rather than losing it.
    const a = active.current;
    if (a?.kind === "ward") m.setFeatureState({ source: "wards", id: a.id }, { active: true });
  }, [areas, ready]);

  /** Stop both animation loops if the component goes away mid-flight. */
  useEffect(
    () => () => {
      if (orbitRaf.current !== null) cancelAnimationFrame(orbitRaf.current);
      if (growRaf.current !== null) cancelAnimationFrame(growRaf.current);
    },
    [],
  );

  // --- 2D / 3D switch -------------------------------------------------------
  useEffect(() => {
    if (!ready || !map.current) return;
    const m = map.current;
    const is3d = mode === "3d";

    m.setLayoutProperty("report-pillars", "visibility", is3d ? "visible" : "none");
    m.setLayoutProperty("report-dots", "visibility", is3d ? "none" : "visible");
    if (m.getLayer("building-3d")) {
      m.setLayoutProperty("building-3d", "visibility", is3d ? "visible" : "none");
    }
    // The glow anchors pillars to the ground; in flat mode the dots are the marker.
    m.setLayoutProperty("report-glow", "visibility", is3d ? "visible" : "none");

    m.easeTo({
      pitch: is3d ? OVERVIEW_PITCH : 0,
      bearing: is3d ? -18 : 0,
      duration: 700,
      easing: (t) => 1 - Math.pow(1 - t, 4),
    });
  }, [mode, ready]);

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

/**
 * Where an official's pin goes: the area-weighted centroid of their wards, so it sits in the
 * middle of the outlined shape rather than the middle of its bounding box (an L-shaped zone's
 * box centre can fall outside it). If the centroid still lands outside every ward (a crescent),
 * snap to the nearest ward's own centroid. Falls back to the bbox centre with no geometry.
 */
function shapeCentre(
  wards: { properties: { zone: string }; geometry: { coordinates: number[][][][] } }[],
  zones: string[],
  bbox: [number, number, number, number],
): [number, number] {
  const want = new Set(zones);
  let A = 0, X = 0, Y = 0;
  const cents: { x: number; y: number; ring: number[][] }[] = [];
  for (const w of wards) {
    if (!want.has(w.properties.zone)) continue;
    for (const poly of w.geometry.coordinates) {
      const r = poly[0];
      let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        a += f;
        cx += (r[j][0] + r[i][0]) * f;
        cy += (r[j][1] + r[i][1]) * f;
      }
      if (Math.abs(a) < 1e-12) continue;
      cents.push({ x: cx / (3 * a), y: cy / (3 * a), ring: r });
      A += a / 2;
      X += cx / 6;
      Y += cy / 6;
    }
  }
  if (!cents.length || Math.abs(A) < 1e-12) return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  const x = X / A, y = Y / A;
  const inside = (r: number[][]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    return c;
  };
  if (cents.some((c) => inside(c.ring))) return [x, y];
  const near = cents.reduce((b, c) => ((c.x - x) ** 2 + (c.y - y) ** 2 < (b.x - x) ** 2 + (b.y - y) ** 2 ? c : b));
  return [near.x, near.y];
}

export default Map3D;
