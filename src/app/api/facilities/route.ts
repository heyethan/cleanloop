/**
 * GET /api/facilities — real OpenStreetMap waste infrastructure across Bengaluru.
 *
 * Importers/callers: called over HTTP by src/components/Map3D.tsx.
 * Affected API: this route's own HTTP contract (GET, returns a GeoJSON FeatureCollection).
 * Data schemas: reads waste_facilities {id text, amenity text, lat/lng float, name,
 * operator}. No dates returned.
 * User instruction, verbatim: "I want actual data to be populated in as many areas as possible"
 *
 * This layer is GENUINELY REAL — 574 bins, recycling and disposal points imported
 * from OSM. It is the honest counterweight to the synthetic report layer, and it
 * makes the product argument visible: dumping clusters where bins are absent.
 */

import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export async function GET() {
  try {
    const db = serverClient();
    const { data, error } = await db
      .from("waste_facilities")
      .select("id,amenity,lat,lng,name,operator")
      .limit(2000);
    if (error) throw new Error(error.message);

    const features = (data ?? []).map((f) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [f.lng as number, f.lat as number],
      },
      properties: {
        id: f.id,
        amenity: f.amenity,
        name: f.name,
        operator: f.operator,
      },
    }));

    return NextResponse.json({
      type: "FeatureCollection",
      features,
      source: "OpenStreetMap contributors (ODbL)",
      count: features.length,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
