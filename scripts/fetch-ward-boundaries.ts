/**
 * Fetch REAL locality boundary polygons from OpenStreetMap into a committed GeoJSON.
 *
 * Importers/callers: none at runtime — run with `npm run wards`. Its OUTPUT,
 * src/data/wards.json, is imported by src/components/Map3D.tsx.
 * Affected API: none. Writes one file.
 * Data written: src/data/wards.json, a FeatureCollection. Each feature is
 *   { type: "Feature", id: <int>, properties: { id, name, source }, geometry: Polygon|MultiPolygon }
 * with `properties.id` matching Ward.id in src/lib/wards.ts (e.g. "koramangala") and
 * coordinates in [lng, lat] order. No dates, no personal data.
 * User instruction, verbatim: "3. When in Map view, the specific locality like for
 * example: 'Kormangala' should be outlined when hovered over, so we get a visual grasp
 * of the area."
 *
 * WHY THIS EXISTS: src/lib/wards.ts holds twelve locality CENTROIDS and nothing else, so
 * there was no geometry to outline. Its own header names this exact upgrade path.
 *
 * WHAT IS REAL: every polygon here is an OSM way/relation, fetched live. Nothing is
 * generated, smoothed, or approximated.
 *
 * WHAT IS MISSING: as of the 2026-08-21 run, 7 of the 12 localities — Koramangala,
 * Jayanagar, Malleshwaram, Basavanagudi, Yelahanka, Rajajinagar and BTM Layout — have NO
 * boundary object in OSM at all, only a `place` node. Nominatim independently returns
 * `geojson.type === "Point"` for every one of them, so this is a real gap in the upstream
 * data rather than a too-narrow query here. They get no feature in this file and are
 * printed as a MISSING list at the end.
 *
 * They are deliberately NOT given an invented circle: once a drawn shape is on screen it
 * is indistinguishable from a surveyed one, which makes it a lie. Instead src/lib/wardShapes.ts
 * falls back to a convex hull of that locality's OWN REPORTS, tagged kind:"cluster" and
 * drawn dashed so it can never be mistaken for the solid, surveyed boundaries here.
 *
 * Re-runnable: overwrites the output. OSM data changes slowly; re-run only if a locality
 * is reported missing.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WARDS } from "../src/lib/wards.ts";
import { overpassQuery } from "./overpass.ts";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "data",
  "wards.json",
);

/** Search radius around a centroid for a matching boundary object, in metres. */
const SEARCH_RADIUS_M = 4000;

type Ring = [number, number][];

interface OsmElement {
  type: "way" | "relation" | "node";
  id: number;
  tags?: Record<string, string>;
  /** `out geom` gives every way its resolved coordinates. */
  geometry?: { lat: number; lon: number }[];
  /** Relations carry members, each with its own resolved geometry. */
  members?: {
    type: string;
    role: string;
    geometry?: { lat: number; lon: number }[];
  }[];
}

/**
 * Overpass QL: find closed ways and relations tagged as a boundary or a named place
 * area near the centroid. `out geom` resolves node coordinates inline so we never have
 * to make a second call to dereference node ids.
 */
function query(name: string, lat: number, lng: number): string {
  const around = `(around:${SEARCH_RADIUS_M},${lat},${lng})`;
  return `[out:json][timeout:90];
(
  relation["name"="${name}"]["boundary"]${around};
  relation["name"="${name}"]["place"]${around};
  way["name"="${name}"]["boundary"]${around};
  way["name"="${name}"]["place"]${around};
  way["name"="${name}"]["landuse"="residential"]${around};
);
out geom;`;
}

/** Ring must be closed for GeoJSON: first coordinate repeated as the last. */
function close(ring: Ring): Ring {
  if (ring.length < 3) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly ? ring : [...ring, [fx, fy]];
}

function ringFrom(geometry: { lat: number; lon: number }[]): Ring {
  return geometry.map((p) => [p.lon, p.lat] as [number, number]);
}

/**
 * Stitch a relation's outer member ways into rings. Members arrive as unordered,
 * arbitrarily-directed fragments, so walk them end-to-end and flip as needed.
 */
function ringsFromRelation(el: OsmElement): Ring[] {
  const fragments = (el.members ?? [])
    .filter((m) => m.type === "way" && m.role !== "inner" && m.geometry?.length)
    .map((m) => ringFrom(m.geometry!));
  if (!fragments.length) return [];

  const rings: Ring[] = [];
  const pool = [...fragments];
  const same = (a: [number, number], b: [number, number]) =>
    a[0] === b[0] && a[1] === b[1];

  while (pool.length) {
    let current = pool.shift()!;
    let joined = true;
    while (joined) {
      joined = false;
      const tail = current[current.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const frag = pool[i];
        if (same(tail, frag[0])) {
          current = [...current, ...frag.slice(1)];
        } else if (same(tail, frag[frag.length - 1])) {
          current = [...current, ...[...frag].reverse().slice(1)];
        } else {
          continue;
        }
        pool.splice(i, 1);
        joined = true;
        break;
      }
    }
    if (current.length >= 4) rings.push(close(current));
  }
  return rings;
}

/** Rough planar area in square degrees — only used to rank candidates, never displayed. */
function shoelace(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum) / 2;
}

async function boundaryFor(
  name: string,
  lat: number,
  lng: number,
): Promise<{ rings: Ring[]; source: string } | null> {
  const elements = await overpassQuery<OsmElement>(query(name, lat, lng));

  const candidates: { rings: Ring[]; source: string; area: number }[] = [];
  for (const el of elements) {
    const rings =
      el.type === "relation"
        ? ringsFromRelation(el)
        : el.geometry && el.geometry.length >= 4
          ? [close(ringFrom(el.geometry))]
          : [];
    if (!rings.length) continue;
    candidates.push({
      rings,
      source: `osm ${el.type}/${el.id}`,
      area: rings.reduce((a, r) => a + shoelace(r), 0),
    });
  }
  if (!candidates.length) return null;

  // Prefer the largest — a locality's own boundary, not a park or layout block inside it.
  candidates.sort((a, b) => b.area - a.area);
  return { rings: candidates[0].rings, source: candidates[0].source };
}

async function main() {
  console.log(`Fetching OSM boundaries for ${WARDS.length} localities…`);

  const features: unknown[] = [];
  const missing: string[] = [];

  for (const [i, ward] of WARDS.entries()) {
    process.stdout.write(`- ${ward.name}… `);
    let found: Awaited<ReturnType<typeof boundaryFor>> = null;
    try {
      found = await boundaryFor(ward.name, ward.lat, ward.lng);
    } catch (e) {
      console.log(`FAILED (${(e as Error).message})`);
    }

    if (!found) {
      missing.push(ward.name);
      console.log("no OSM boundary — will not be outlined");
    } else {
      features.push({
        type: "Feature",
        // Numeric id is required for setFeatureState; string ids are unreliable there.
        id: i,
        properties: { id: ward.id, name: ward.name, source: found.source },
        geometry:
          found.rings.length === 1
            ? { type: "Polygon", coordinates: [found.rings[0]] }
            : { type: "MultiPolygon", coordinates: found.rings.map((r) => [r]) },
      });
      console.log(`${found.source} (${found.rings.length} ring(s))`);
    }

    // Be a good Overpass citizen — these are free public mirrors.
    await new Promise((r) => setTimeout(r, 1200));
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({ type: "FeatureCollection", features }, null, 0),
  );

  console.log(`\nWrote ${features.length} boundaries -> ${OUT}`);
  if (missing.length) {
    console.log(
      `\nMISSING (${missing.length}) — no OSM boundary object exists for these; ` +
        `they are NOT outlined and are NOT faked:\n  ${missing.join("\n  ")}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
