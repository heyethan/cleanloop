/**
 * Flatten GET /api/areas into AreaPick rows (10 zones, then 369 wards), each with its bounding box.
 *
 * Importers/callers: src/app/page.tsx (search, tap card, officials fly), src/components/Map3D.tsx.
 * Affected API: exports areaPicks(). Client-safe: works on the fetched JSON, never on
 * src/data/gba-wards.json directly (that file stays server-side).
 */
import type { AreaPick, Areas } from "./types";

export function areaPicks(areas: Areas): AreaPick[] {
  const zones: AreaPick[] = areas.zones.features.map(({ properties: z }) => ({
    kind: "zone",
    id: z.zone,
    name: z.zone,
    name_kn: null,
    zone: z.zone,
    corporation: z.corporation,
    open: z.open,
    overdue: z.overdue,
    bbox: z.bbox,
  }));
  const wards: AreaPick[] = areas.wards.features.map(({ properties: w, geometry }) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of geometry.coordinates)
      for (const [x, y] of poly[0]) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    return { kind: "ward", id: w.id, name: w.name, name_kn: w.name_kn, zone: w.zone, corporation: w.corporation, open: w.open, overdue: w.overdue, bbox: [minX, minY, maxX, maxY] };
  });
  return [...zones, ...wards];
}
