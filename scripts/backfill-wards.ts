/**
 * Fill gba_ward_id, corporation and zone on existing reports from their coordinates.
 *
 *   infisical run ... -- node --experimental-strip-types scripts/backfill-wards.ts [--dry-run]
 *
 * Affected API: CLI only. Reads/writes reports (service role). Idempotent: only rows whose
 * gba_ward_id is still null are touched. Points outside the 369 wards are reported, not guessed.
 */
import { createClient } from "@supabase/supabase-js";
import { wardAt } from "../src/lib/gbaWards.ts";

const dry = process.argv.includes("--dry-run");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await db.from("reports").select("id, lat, lng").is("gba_ward_id", null);
if (error) throw error;

let mapped = 0;
const outside: string[] = [];
for (const r of data ?? []) {
  const w = wardAt(r.lat, r.lng);
  if (!w) { outside.push(`${r.id} (${r.lat}, ${r.lng})`); continue; }
  mapped++;
  if (!dry) {
    const { error: e } = await db
      .from("reports")
      .update({ gba_ward_id: w.id, corporation: w.corporation, zone: w.zone_name })
      .eq("id", r.id);
    if (e) throw e;
  }
}
console.log(`${dry ? "[dry-run] " : ""}${mapped} mapped, ${outside.length} outside the 369 wards`);
for (const o of outside) console.log("  outside:", o);
