/**
 * Road segments: snap a report to the road it's on, and score how drivable a road is.
 *
 * Affected API: exports ROADS, snapToRoad(), roadQuality(). Server-side only (2.4 MB of
 * geometry): used by POST /api/reports (road reports) and GET /api/roads; checked in selfcheck.
 * Data: src/data/roads.json from scripts/fetch-roads.ts, © OpenStreetMap contributors (ODbL).
 * Quality: open road reports add severity × e^(−age/30 days); ≥ 1.5 is "poor". A road whose
 * reports were all verified fixed in the last 90 days is "good"; no evidence is "unknown".
 */
import data from "../data/roads.json" with { type: "json" };

interface Road {
  properties: { id: string; name: string | null; highway: string | null };
  geometry: { coordinates: [number, number][] };
}
export const ROADS = (data as unknown as { features: Road[] }).features;

const SNAP_METRES = 30;
const M_PER_DEG_LAT = 111_320;

// Bounding boxes, padded by the snap distance, so most roads are skipped with four comparisons.
const pad = SNAP_METRES / M_PER_DEG_LAT;
const boxes = ROADS.map((r) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of r.geometry.coordinates) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { r, minX: minX - pad * 1.1, maxX: maxX + pad * 1.1, minY: minY - pad, maxY: maxY + pad };
});

/** Metres from point P to segment AB, in a local flat projection (fine at street scale). */
function toSegment(lat: number, lng: number, a: [number, number], b: [number, number]): number {
  const kx = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const ax = (a[0] - lng) * kx, ay = (a[1] - lat) * M_PER_DEG_LAT;
  const bx = (b[0] - lng) * kx, by = (b[1] - lat) * M_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function snapToRoad(lat: number, lng: number): { id: string; name: string | null; metres: number } | null {
  let best: { id: string; name: string | null; metres: number } | null = null;
  for (const { r, minX, maxX, minY, maxY } of boxes) {
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    const c = r.geometry.coordinates;
    for (let i = 1; i < c.length; i++) {
      const m = toSegment(lat, lng, c[i - 1], c[i]);
      if (m <= SNAP_METRES && (!best || m < best.metres)) best = { id: r.properties.id, name: r.properties.name, metres: m };
    }
  }
  return best;
}

export function roadQuality(
  reports: { severity: number; status: string; created_at: string }[],
  now = Date.now(),
): "good" | "poor" | "unknown" {
  if (reports.length === 0) return "unknown";
  const age = (r: { created_at: string }) => (now - Date.parse(r.created_at)) / 86_400_000;
  const open = reports.filter((r) => r.status === "open" || r.status === "claimed");
  const score = open.reduce((sum, r) => sum + r.severity * Math.exp(-age(r) / 30), 0);
  if (score >= 1.5) return "poor";
  const fixedRecently = reports.some((r) => (r.status === "verified_resolved" || r.status === "awaiting_confirmation") && age(r) <= 90);
  return open.length === 0 && fixedRecently ? "good" : "unknown";
}
