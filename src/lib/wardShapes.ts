/**
 * Locality shapes for the map outline — real OSM boundaries plus honest report hulls.
 *
 * Importers/callers: src/components/Map3D.tsx.
 * Affected API: exports WardShapeKind, buildWardShapes().
 * Data schemas: reads src/data/wards.geojson (features with properties {id, name, source},
 * coordinates [lng, lat]) and Report[] from src/lib/types.ts (uses lat, lng, ward_id only).
 * Returns a FeatureCollection whose features carry
 * properties { id, name, kind: "official" | "cluster" }. No dates, no personal data.
 * User instruction, verbatim: "3. When in Map view, the specific locality like for
 * example: 'Kormangala' should be outlined when hovered over, so we get a visual grasp
 * of the area."
 *
 * WHY TWO KINDS — this is the honest bit, and the UI must keep them apart:
 *
 *   OpenStreetMap has a real boundary polygon for only 5 of the 12 localities
 *   (Indiranagar, Whitefield, HSR Layout, Marathahalli, Bellandur). The other seven —
 *   INCLUDING Koramangala — exist in OSM purely as a single `place` node. Nominatim
 *   returns `geojson.type === "Point"` for every one of them, so this is a genuine gap in
 *   the source data, not a bad Overpass query.
 *
 *   Rather than invent a boundary (a drawn circle is indistinguishable from a surveyed
 *   one once it is on screen, which makes it a lie), the missing seven get a convex hull
 *   of THEIR OWN REPORTS. That is real data — it is where cases actually are — but it is
 *   emphatically NOT a civic boundary, so it is tagged kind:"cluster", drawn dashed, and
 *   labelled differently in the legend. Solid means surveyed; dashed means "our cases".
 *
 *   For a waste app the cluster arguably carries more meaning than the boundary: it shows
 *   where the problem is, not where an administrator drew a line.
 */

import type { Report } from "@/lib/types";
import { WARDS } from "@/lib/wards";
import official from "@/data/wards.json";

export type WardShapeKind = "official" | "cluster";

type Pt = [number, number];

interface WardFeature {
  type: "Feature";
  id: number;
  properties: { id: string; name: string; kind: WardShapeKind };
  geometry:
    | { type: "Polygon"; coordinates: Pt[][] }
    | { type: "MultiPolygon"; coordinates: Pt[][][] };
}

interface OfficialFeature {
  properties: { id: string; name: string; source: string };
  geometry:
    | { type: "Polygon"; coordinates: Pt[][] }
    | { type: "MultiPolygon"; coordinates: Pt[][][] };
}

/** Minimum padding applied around a report hull, in degrees (~110m of latitude). */
const HULL_PAD_DEG = 0.001;
/** Fraction of the hull's own radius added as padding, so dense clusters still read. */
const HULL_PAD_RATIO = 0.18;
/** Below this many reports a hull is meaningless — two points is a line, not an area. */
const MIN_HULL_POINTS = 3;

/** Cross product of OA x OB. >0 = counter-clockwise turn. */
function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Andrew's monotone chain convex hull. Convex rather than concave deliberately: a concave
 * hull needs a tuning parameter, and a wrong one produces spidery shapes that look like a
 * bug. Convex is boring, stable and obviously an approximation — which is what we want,
 * since this must never be mistaken for a surveyed boundary.
 */
function convexHull(points: Pt[]): Pt[] {
  if (points.length < MIN_HULL_POINTS) return [];
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const half = (src: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };

  const hull = [...half(pts), ...half([...pts].reverse())];
  return hull.length >= MIN_HULL_POINTS ? hull : [];
}

/** Push every hull vertex away from the centroid so pins sit inside, not on, the edge. */
function padHull(hull: Pt[]): Pt[] {
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;

  return hull.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy) || 1e-9;
    const grow = (d * HULL_PAD_RATIO + HULL_PAD_DEG) / d;
    return [x + dx * grow, y + dy * grow] as Pt;
  });
}

/**
 * Build the outline layer's data. Official boundaries are used wherever OSM has one;
 * everything else falls back to a padded hull of that locality's reports. A locality with
 * neither gets no feature at all — it simply does not outline.
 */
export function buildWardShapes(reports: Report[]): {
  type: "FeatureCollection";
  features: WardFeature[];
} {
  const officialFeatures = (official as unknown as { features: OfficialFeature[] })
    .features;
  const haveOfficial = new Set(officialFeatures.map((f) => f.properties.id));

  const features: WardFeature[] = [];

  // Stable numeric ids: MapLibre's setFeatureState is unreliable with string ids, and the
  // index into WARDS is stable across renders in a way that array position here is not.
  const indexOf = new Map(WARDS.map((w, i) => [w.id, i]));

  for (const f of officialFeatures) {
    features.push({
      type: "Feature",
      id: indexOf.get(f.properties.id) ?? features.length,
      properties: {
        id: f.properties.id,
        name: f.properties.name,
        kind: "official",
      },
      geometry: f.geometry,
    });
  }

  // Group the remaining localities' reports so each can get a hull.
  const byWard = new Map<string, Pt[]>();
  for (const r of reports) {
    if (!r.ward_id || haveOfficial.has(r.ward_id)) continue;
    const list = byWard.get(r.ward_id);
    const p: Pt = [r.lng, r.lat];
    if (list) list.push(p);
    else byWard.set(r.ward_id, [p]);
  }

  for (const ward of WARDS) {
    if (haveOfficial.has(ward.id)) continue;
    const pts = byWard.get(ward.id);
    if (!pts || pts.length < MIN_HULL_POINTS) continue;

    const hull = convexHull(pts);
    if (!hull.length) continue;

    const ring = padHull(hull);
    ring.push(ring[0]); // GeoJSON rings must close.

    features.push({
      type: "Feature",
      id: indexOf.get(ward.id) ?? features.length,
      properties: { id: ward.id, name: ward.name, kind: "cluster" },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }

  return { type: "FeatureCollection", features };
}
