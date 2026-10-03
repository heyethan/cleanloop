/**
 * Geo helpers for a Bengaluru-only app: distance and the city bounds.
 *
 * Importers/callers: src/app/api/reports/route.ts and ReportSheet (isInBengaluru),
 * src/lib/supabase.ts and src/lib/durability.ts (haversineMetres), scripts/seed.ts.
 * Affected API: exports haversineMetres(), BENGALURU_BOUNDS, isInBengaluru().
 * Data: none. No file I/O, no dates.
 *
 * Wards are the real GBA delimitation now (src/lib/gbaWards.ts, server-side; GET /api/areas for
 * the map). The 12 hand-picked locality centroids that used to live here are gone from the app;
 * only scripts/seed.ts keeps a copy, to place its synthetic demo points.
 */

/** Great-circle distance in metres. */
export function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * [[west, south], [east, north]] — the same box the map camera is clamped to.
 *
 * This exists because "is it a valid coordinate on Earth" is the wrong question for a
 * Bengaluru-only app. A half-filled manual location form yielded lat 1 / lng 0 — a point
 * in the Gulf of Guinea — which passed a -90..90 / -180..180 check and was written to the
 * database as a real report. Validate against the city, not the planet.
 */
export const BENGALURU_BOUNDS: [[number, number], [number, number]] = [
  [77.43, 12.8],
  [77.81, 13.17],
];

export function isInBengaluru(lat: number, lng: number): boolean {
  const [[west, south], [east, north]] = BENGALURU_BOUNDS;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= south &&
    lat <= north &&
    lng >= west &&
    lng <= east
  );
}
