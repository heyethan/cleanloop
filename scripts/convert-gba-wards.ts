/**
 * Convert OpenCity's GBA 369-ward KML into the GeoJSON the app looks wards up in.
 *
 *   node --experimental-strip-types scripts/convert-gba-wards.ts <wards.kml>
 *
 * Source: https://data.opencity.in/dataset/gba-wards-delimitation-2025 (Dec 2025 KML, public
 * domain per OpenCity; attribute OpenCity and the GBA notification).
 * Affected API: writes src/data/gba-wards.json, read by src/lib/wards.ts (wardAt/wardMeta).
 * Feature properties: { id: "<corporation>-<ward no>", ward_no, name, name_kn, corporation,
 * zone, zone_name, assembly }. Rings are Douglas-Peucker simplified to ~10 m and rounded to
 * 5 decimals, which keeps the file small while staying far inside a ward's width.
 */
import { readFileSync, writeFileSync } from "node:fs";

type Pt = [number, number];
const TOLERANCE = 0.0001; // degrees, ~11 m

function simplify(pts: Pt[]): Pt[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      // A closed ring starts and ends on the same point, so that "line" has no length:
      // measure from the point instead, or every vertex scores 0 and the ring collapses.
      const d =
        dx === 0 && dy === 0
          ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
          : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > worst) { worst = d; idx = i; }
    }
    if (worst > TOLERANCE) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const kml = readFileSync(process.argv[2], "utf8");
const field = (pm: string, name: string) =>
  new RegExp(`<SimpleData name="${name}">([^<]*)</SimpleData>`).exec(pm)?.[1]?.trim() ?? null;

const features = [...kml.matchAll(/<Placemark>[\s\S]*?<\/Placemark>/g)].map(([pm]) => {
  const corporation = field(pm, "Corporation")!;
  const wardNo = Number(field(pm, "ward_id"));
  // Outer rings only: the delimitation has no holes, and each <coordinates> block is one polygon.
  const polygons = [...pm.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)].map(([, c]) => [
    simplify(
      c.trim().split(/\s+/).map((t) => {
        const [lng, lat] = t.split(",").map(Number);
        return [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] as Pt;
      }),
    ),
  ]);
  return {
    type: "Feature",
    properties: {
      id: `${corporation.toLowerCase()}-${wardNo}`,
      ward_no: wardNo,
      name: field(pm, "ward_name"),
      name_kn: field(pm, "ward_name_kn"),
      corporation,
      zone: field(pm, "zone"),
      zone_name: field(pm, "zone_name"),
      assembly: field(pm, "Assembly"),
    },
    geometry: { type: "MultiPolygon", coordinates: polygons },
  };
});

writeFileSync(
  "src/data/gba-wards.json",
  JSON.stringify({
    type: "FeatureCollection",
    attribution: "Ward boundaries: GBA delimitation Dec 2025 via OpenCity (data.opencity.in)",
    features,
  }),
);
console.log(`wrote ${features.length} wards`);
