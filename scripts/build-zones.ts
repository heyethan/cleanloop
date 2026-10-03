/**
 * Precompute the 10 GBA zone outlines from the 369 ward polygons (one-time, no geometry library).
 *
 *   node --experimental-strip-types scripts/build-zones.ts
 *
 * Affected API: writes src/data/gba-zones.json, read by src/app/api/areas/route.ts.
 * Data schema: { zones: [{ zone_name, corporation, bbox: [w, s, e, n], outline: [[lng, lat][]] }] }.
 *
 * Why outlines and not dissolved polygons: the ward rings were simplified one by one, so ~40% of
 * the borders two wards share do not have identical vertices, and a naive dissolve leaves the
 * inner ward lines in. The map fills a zone by painting its wards (same geometry, already sent),
 * so the only thing a zone needs of its own is its outer edge. A ward edge is "inner" when it is
 * shared exactly, or its midpoint lies within INNER_M of another ward of the same zone.
 */
import { readFileSync, writeFileSync } from "node:fs";

type Pt = [number, number];
const INNER_M = 18;
const M_PER_DEG = 111_320;

const wards = JSON.parse(readFileSync("src/data/gba-wards.json", "utf8")).features as {
  properties: { id: string; zone_name: string; corporation: string };
  geometry: { coordinates: Pt[][][] };
}[];

/** Distance in metres from p to segment ab (equirectangular, fine at city scale). */
function distM(p: Pt, a: Pt, b: Pt): number {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * k, ay = a[1] - p[1], bx = (b[0] - p[0]) * k, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-18)));
  return Math.hypot(ax + t * dx, ay + t * dy) * M_PER_DEG;
}

const byZone = new Map<string, typeof wards>();
for (const w of wards) byZone.set(w.properties.zone_name, [...(byZone.get(w.properties.zone_name) ?? []), w]);

const zones = [...byZone].map(([zone_name, ws]) => {
  const segs = ws.flatMap((w) =>
    w.geometry.coordinates.flatMap((poly) => poly.flatMap((ring) => ring.slice(1).map((b, i) => ({ ward: w.properties.id, a: ring[i], b })))),
  );
  const key = (a: Pt, b: Pt) => (a.join() < b.join() ? a.join() + "|" + b.join() : b.join() + "|" + a.join());
  const seen = new Map<string, number>();
  for (const s of segs) seen.set(key(s.a, s.b), (seen.get(key(s.a, s.b)) ?? 0) + 1);

  const pad = INNER_M / M_PER_DEG * 2;
  // ponytail: O(n²) per zone (~2k segments), fine for a one-time build script.
  const inner = (s: (typeof segs)[number]) => {
    if (seen.get(key(s.a, s.b))! > 1) return true;
    const mid: Pt = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
    return segs.some(
      (o) =>
        o.ward !== s.ward &&
        Math.min(o.a[0], o.b[0]) - pad < mid[0] && Math.max(o.a[0], o.b[0]) + pad > mid[0] &&
        Math.min(o.a[1], o.b[1]) - pad < mid[1] && Math.max(o.a[1], o.b[1]) + pad > mid[1] &&
        distM(mid, o.a, o.b) < INNER_M,
    );
  };

  // Chain consecutive outer segments of each ring into runs, so the file stays small.
  const outline: Pt[][] = [];
  let run: Pt[] = [];
  let last: Pt | null = null;
  for (const s of segs) {
    if (inner(s)) continue;
    if (last && last[0] === s.a[0] && last[1] === s.a[1]) run.push(s.b);
    else {
      if (run.length > 1) outline.push(run);
      run = [s.a, s.b];
    }
    last = s.b;
  }
  if (run.length > 1) outline.push(run);

  const all = segs.flatMap((s) => [s.a, s.b]);
  const bbox = [
    Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])),
    Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1])),
  ];
  console.log(`${zone_name}: ${ws.length} wards, ${segs.length} edges -> ${outline.length} outline runs`);
  return { zone_name, corporation: ws[0].properties.corporation, bbox, outline };
});

writeFileSync("src/data/gba-zones.json", JSON.stringify({ zones }));
console.log(`wrote src/data/gba-zones.json (${zones.length} zones)`);
