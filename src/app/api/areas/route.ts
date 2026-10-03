/**
 * GET /api/areas — the 369 GBA wards and 10 zones as map GeoJSON, with live open/overdue counts.
 *
 * Importers/callers: fetched once by src/app/page.tsx, which hands it to Map3D (area layers) and
 * CommandPalette (ward/zone search). Public, cacheable.
 * Affected API: this route's HTTP contract:
 *   { wards: FeatureCollection<MultiPolygon, {id, ward_no, name, name_kn, zone, corporation, open, overdue}>,
 *     zones: FeatureCollection<MultiLineString, {zone, corporation, bbox, open, overdue}> }
 * Data schemas: src/data/gba-wards.json (geometry already 5-decimal), src/data/gba-zones.json
 * (outer outlines from scripts/build-zones.ts). Counts from src/lib/areas.ts.
 */
import { NextResponse } from "next/server";
import { serverClient, loadAreaCounts } from "@/lib/supabase";
import wardData from "@/data/gba-wards.json";
import zoneData from "@/data/gba-zones.json";

interface WardFeature {
  properties: { id: string; ward_no: number; name: string; name_kn: string; zone_name: string; corporation: string };
  geometry: unknown;
}

export async function GET() {
  try {
    const { counts } = await loadAreaCounts(serverClient());
    const c = (k: string) => counts.get(k) ?? { open: 0, overdue: 0 };
    const wards = (wardData as unknown as { features: WardFeature[] }).features.map(({ properties: p, geometry }) => ({
      type: "Feature" as const,
      geometry,
      properties: { id: p.id, ward_no: p.ward_no, name: p.name, name_kn: p.name_kn, zone: p.zone_name, corporation: p.corporation, ...c(`ward:${p.id}`) },
    }));
    const zones = zoneData.zones.map((z) => ({
      type: "Feature" as const,
      geometry: { type: "MultiLineString" as const, coordinates: z.outline },
      properties: { zone: z.zone_name, corporation: z.corporation, bbox: z.bbox, ...c(`zone:${z.zone_name}`) },
    }));
    return NextResponse.json(
      { wards: { type: "FeatureCollection", features: wards }, zones: { type: "FeatureCollection", features: zones } },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
