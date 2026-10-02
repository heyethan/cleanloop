/**
 * Fetch Bengaluru's major roads from OpenStreetMap for the road-quality layer.
 *
 *   node --experimental-strip-types scripts/fetch-roads.ts
 *
 * Affected API: writes src/data/roads.json (server-side only: read by src/lib/roads.ts for
 * snapping reports and by GET /api/roads). Data © OpenStreetMap contributors, ODbL.
 * Properties: { id: "way/<osm id>", name, highway }. trunk/primary/secondary only, to keep the
 * file small enough to load per request; coordinates rounded to 5 decimals (~1 m).
 */
import { writeFileSync } from "node:fs";
import { overpassQuery } from "./overpass.ts";
import { BENGALURU_BOUNDS } from "../src/lib/wards.ts";

const [[w, s], [e, n]] = BENGALURU_BOUNDS;
type Way = { type: "way"; id: number; tags?: { name?: string; highway?: string }; geometry?: { lat: number; lon: number }[] };
const ways = await overpassQuery<Way>(
  `[out:json][timeout:120];way["highway"~"^(trunk|primary|secondary)$"](${s},${w},${n},${e});out tags geom;`,
);
const features = ways
  .filter((x) => x.geometry && x.geometry.length > 1)
  .map((x) => ({
    type: "Feature",
    properties: { id: `way/${x.id}`, name: x.tags?.name ?? null, highway: x.tags?.highway ?? null },
    geometry: {
      type: "LineString",
      coordinates: x.geometry!.map((p) => [Math.round(p.lon * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5]),
    },
  }));
writeFileSync(
  "src/data/roads.json",
  JSON.stringify({ type: "FeatureCollection", attribution: "© OpenStreetMap contributors (ODbL)", features }),
);
console.log(`wrote ${features.length} road segments`);
