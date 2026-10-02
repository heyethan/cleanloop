/**
 * GET /api/roads — live road quality as open GeoJSON (for the map layer and for anyone else).
 *
 * Importers/callers: src/components/Map3D.tsx (road layer); public, cacheable.
 * One LineString per road segment that has citizen road reports, with quality good | poor |
 * unknown (src/lib/roads.ts), report counts and the latest report date. Segments with no reports
 * are omitted to keep the payload small. Licence: CleanLoop reports CC-BY-4.0; road geometry
 * © OpenStreetMap contributors (ODbL).
 */
import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { ROADS, roadQuality } from "@/lib/roads";

export async function GET() {
  const { data, error } = await serverClient()
    .from("reports")
    .select("road_segment_id, severity, status, created_at")
    .eq("category", "road")
    .not("road_segment_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const bySegment = new Map<string, NonNullable<typeof data>>();
  for (const r of data ?? []) bySegment.set(r.road_segment_id!, [...(bySegment.get(r.road_segment_id!) ?? []), r]);
  const byId = new Map(ROADS.map((r) => [r.properties.id, r]));

  const features = [...bySegment].flatMap(([id, reports]) => {
    const road = byId.get(id);
    if (!road) return [];
    return [{
      type: "Feature" as const,
      geometry: road.geometry,
      properties: {
        id,
        name: road.properties.name,
        quality: roadQuality(reports),
        reports: reports.length,
        open: reports.filter((r) => r.status === "open" || r.status === "claimed").length,
        last_reported: reports.map((r) => r.created_at).sort().at(-1),
      },
    }];
  });

  return NextResponse.json(
    {
      type: "FeatureCollection",
      license: "CleanLoop road reports: CC-BY-4.0. Road geometry: © OpenStreetMap contributors, ODbL.",
      attribution: "CleanLoop (getcleanloop.vercel.app) · © OpenStreetMap contributors",
      generated_at: new Date().toISOString(),
      features,
    },
    { headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=1800" } },
  );
}
