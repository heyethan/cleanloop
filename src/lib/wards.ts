/**
 * Ward / locality lookup — spec §8 risk #1.
 *
 * Importers/callers: src/app/api/reports/route.ts (assigns ward_id on report creation),
 * src/app/api/leaderboard/route.ts (groups by ward), scripts/seed.ts.
 * Affected API: exports WARDS, haversineMetres(), nearestWard(), wardName().
 * Data: static array of {id, name, lat, lng}. No file I/O, no dates.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 * (ward handling: "Hardcoded lookup table for demo areas" selected).
 *
 * HONESTY NOTE FOR THE PITCH: these are LOCALITY centroids, not BBMP ward boundaries.
 * No public Bengaluru ward-boundary API was confirmed during scoping, so a report is
 * assigned to the nearest locality centroid. That is an approximation and the README
 * says so. It is good enough for the leaderboard's relative comparison and it does not
 * block the core report → classify → verify loop, which ignores wards entirely.
 *
 * Coordinates were fetched from OpenStreetMap Nominatim on 2026-08-20 rather than
 * written from memory. Upgrade path: swap this for point-in-polygon against real
 * boundary GeoJSON — only nearestWard() changes.
 */

export interface Ward {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** Source: OpenStreetMap Nominatim, 2026-08-20. */
export const WARDS: Ward[] = [
  { id: "koramangala", name: "Koramangala", lat: 12.9357366, lng: 77.624081 },
  { id: "indiranagar", name: "Indiranagar", lat: 12.9732913, lng: 77.6404672 },
  { id: "whitefield", name: "Whitefield", lat: 12.9957428, lng: 77.7579489 },
  { id: "jayanagar", name: "Jayanagar", lat: 12.9292731, lng: 77.5824229 },
  { id: "hsr-layout", name: "HSR Layout", lat: 12.9116225, lng: 77.6388622 },
  { id: "marathahalli", name: "Marathahalli", lat: 12.9552572, lng: 77.6984163 },
  { id: "malleshwaram", name: "Malleshwaram", lat: 13.0027353, lng: 77.5703253 },
  { id: "basavanagudi", name: "Basavanagudi", lat: 12.9417261, lng: 77.5755021 },
  { id: "bellandur", name: "Bellandur", lat: 12.9320495, lng: 77.6842915 },
  { id: "yelahanka", name: "Yelahanka", lat: 13.1006982, lng: 77.5963454 },
  { id: "rajajinagar", name: "Rajajinagar", lat: 13.0005232, lng: 77.5496166 },
  { id: "btm-layout", name: "BTM Layout", lat: 12.9140008, lng: 77.6102821 },
];

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
 * Nearest locality centroid, or null if the point is absurdly far from all of them
 * (i.e. not in Bengaluru) — better to store no ward than a wrong one.
 */
export function nearestWard(lat: number, lng: number, maxMetres = 15_000): Ward | null {
  let best: Ward | null = null;
  let bestD = Infinity;
  for (const w of WARDS) {
    const d = haversineMetres(lat, lng, w.lat, w.lng);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return bestD <= maxMetres ? best : null;
}

export function wardName(id: string | null): string | null {
  if (!id) return null;
  return WARDS.find((w) => w.id === id)?.name ?? null;
}
