/**
 * Real GBA wards (369, Dec 2025 delimitation): which ward, zone and corporation a point is in.
 *
 * Affected API: exports GbaWard, wardAt(), wardMeta(). Server-side only (API routes, scripts):
 * it reads the 120 KB boundary file, which must not ship in the client bundle.
 * Data: src/data/gba-wards.json, built by scripts/convert-gba-wards.ts from OpenCity.
 * The older src/lib/wards.ts (10 locality centroids) stays for existing UI labels.
 */
import data from "../data/gba-wards.json" with { type: "json" };

export interface GbaWard {
  id: string;
  ward_no: number;
  name: string;
  name_kn: string;
  corporation: string;
  zone: string;
  zone_name: string;
  assembly: string;
}

type Ring = [number, number][];
interface Feature {
  properties: GbaWard;
  geometry: { coordinates: Ring[][] };
}

const features = (data as unknown as { features: Feature[] }).features;

// Bounding boxes first: most wards are ruled out by four comparisons.
const index = features.map((f) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of f.geometry.coordinates)
    for (const [x, y] of poly[0]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  return { f, minX, minY, maxX, maxY };
});

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The ward containing this point, or null outside the 369 wards. */
export function wardAt(lat: number, lng: number): GbaWard | null {
  for (const { f, minX, minY, maxX, maxY } of index) {
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    if (f.geometry.coordinates.some((poly) => inRing(lng, lat, poly[0]))) return f.properties;
  }
  return null;
}

const byId = new Map(features.map((f) => [f.properties.id, f.properties]));

/** Zone names per corporation, straight from the delimitation (no database query, no row cap). */
export function zonesOf(corporation?: string): string[] {
  return [...new Set(features.filter((f) => !corporation || f.properties.corporation === corporation).map((f) => f.properties.zone_name))].sort();
}

export function wardMeta(id: string): GbaWard | null {
  return byId.get(id) ?? null;
}
