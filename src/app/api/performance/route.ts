/**
 * GET /api/performance — the public accountability numbers as JSON (see src/lib/performance.ts).
 * Importers/callers: anyone (open data); /performance renders the same function server-side.
 */
import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { performance } from "@/lib/performance";

export async function GET() {
  const data = await performance(serverClient());
  return NextResponse.json(data, { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } });
}
