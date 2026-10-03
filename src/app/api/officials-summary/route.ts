/**
 * GET /api/officials-summary — the faces on the map: one named official per area, with how many
 * open and overdue cases sit in it right now. Sorted by overdue.
 *
 * Importers/callers: src/components/OfficialsIsland.tsx. Public, cached 5 minutes.
 * Affected API: { officials: IslandOfficial[] } (src/lib/areas.ts).
 * Data schemas: reads officials, sla_config and open/held reports via loadAreaCounts().
 */
import { NextResponse } from "next/server";
import { serverClient, loadAreaCounts } from "@/lib/supabase";
import { officialsSummary } from "@/lib/areas";
import zoneData from "@/data/gba-zones.json";

export async function GET() {
  try {
    const { counts, officials } = await loadAreaCounts(serverClient());
    const zonesByCorp: Record<string, string[]> = {};
    for (const z of zoneData.zones) (zonesByCorp[z.corporation] ??= []).push(z.zone_name);
    return NextResponse.json(
      { officials: officialsSummary(officials, counts, zonesByCorp) },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
