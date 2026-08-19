/**
 * Supabase clients + geo queries.
 *
 * Importers/callers: src/app/api/reports/route.ts, src/app/api/reports/[id]/resolve/route.ts,
 * src/app/api/leaderboard/route.ts, scripts/seed.ts (server); src/components/* (browser).
 * Affected API: exports serverClient(), browserClient(), findRecurring(), uploadPhoto(),
 * PHOTO_BUCKET, RECURRING_RADIUS_METRES, RECURRING_WINDOW_DAYS.
 * Data schemas: reads/writes the `reports` and `resolutions` tables and the `cleanloop`
 * storage bucket. Timestamps are Postgres timestamptz, serialised as ISO-8601 strings
 * (e.g. "2026-08-20T14:03:11.482Z"). See supabase/schema.sql.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * The service-role client is server-only. RLS allows public SELECT and no public writes,
 * so every mutation goes through an API route holding the service key.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { haversineMetres } from "./wards";
import type { Report } from "./types";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const PHOTO_BUCKET = "cleanloop";

/** Server-side, service role. Never import this into a client component. */
export function serverClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  return createClient(URL, key, { auth: { persistSession: false } });
}

/** Browser-side, anon key, read-only by RLS. */
export function browserClient(): SupabaseClient {
  if (!URL || !ANON) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
    );
  }
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

/** Recurring-spot detection window (spec §3 Flow A step 4: ~50m / 14 days). */
export const RECURRING_RADIUS_METRES = 50;
export const RECURRING_WINDOW_DAYS = 14;

/**
 * Recurring-spot detection — spec §4, P0.
 *
 * Bounding-box prefilter in SQL (hits the (lat,lng) index), then an exact haversine
 * refine in JS. The bbox alone would over-match at the corners; the refine makes the
 * 50m radius actually circular. This is the "simple lat/long bounding-box approximation"
 * fallback from §7 — no PostGIS required.
 *
 * Returns the OLDEST matching report, so a chain of repeats all point at the first one.
 */
export async function findRecurring(
  db: SupabaseClient,
  lat: number,
  lng: number,
  radiusMetres = RECURRING_RADIUS_METRES,
  windowDays = RECURRING_WINDOW_DAYS,
): Promise<Report | null> {
  // 1 deg latitude ≈ 111_320 m everywhere; longitude shrinks by cos(lat).
  const dLat = radiusMetres / 111_320;
  const dLng = radiusMetres / (111_320 * Math.cos((lat * Math.PI) / 180));
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const { data, error } = await db
    .from("reports")
    .select("*")
    .gte("lat", lat - dLat)
    .lte("lat", lat + dLat)
    .gte("lng", lng - dLng)
    .lte("lng", lng + dLng)
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`findRecurring: ${error.message}`);

  const rows = (data ?? []) as Report[];
  for (const r of rows) {
    if (haversineMetres(lat, lng, r.lat, r.lng) <= radiusMetres) return r;
  }
  return null;
}

/** Uploads bytes to the public photo bucket and returns the public URL. */
export async function uploadPhoto(
  db: SupabaseClient,
  bytes: Uint8Array,
  contentType: string,
  prefix: "before" | "after",
): Promise<string> {
  const ext = contentType.includes("png") ? "png" : "jpg";
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage
    .from(PHOTO_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`uploadPhoto: ${error.message}`);
  return db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
