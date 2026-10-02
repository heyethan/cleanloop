/**
 * Pull NammaKasa's approved cases and upsert them into CleanLoop with attribution.
 *
 *   infisical run ... -- node --experimental-strip-types scripts/import-nammakasa.ts [--dry-run] [--raw <file>]
 *
 * Affected API: CLI only. Reads NammaKasa's public read endpoint the way its own site does
 * (anon key taken from its public JS bundle at run time, never stored), requesting ONLY the
 * public columns below — names, notes, moderation data and fingerprints are never fetched.
 * Paged at 1000 rows, ~1 request/s. Writes reports via the service role, upserting on
 * (source, source_id) so re-runs update instead of duplicating. Imports never send email.
 * Live display: after upsert, is_public is set for open cases from the last 90 days that are not
 * within 50 m of a CleanLoop case; everything else is stored but hidden from the map.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { mapNammaKasa, type NammaKasaRow } from "./nammakasa-map.ts";
import { haversineMetres } from "../src/lib/wards.ts";

const COLUMNS = "id,latitude,longitude,address,severity,category,status,resolution_status,photo_url,created_at";
const dry = process.argv.includes("--dry-run");
const rawArg = process.argv.indexOf("--raw");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function discover(): Promise<{ url: string; key: string }> {
  const html = await (await fetch("https://nammakasa.in")).text();
  for (const src of [...html.matchAll(/src="(\/[^"]+\.js)"/g)].map((m) => m[1])) {
    const js = await (await fetch(`https://nammakasa.in${src}`)).text();
    const url = /https:\/\/[a-z0-9]+\.supabase\.co/.exec(js)?.[0];
    const key = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(js)?.[0];
    if (url && key) return { url, key };
  }
  throw new Error("could not find NammaKasa's public endpoint");
}

let rows: NammaKasaRow[] = [];
if (rawArg > 0) {
  rows = JSON.parse(readFileSync(process.argv[rawArg + 1], "utf8"));
} else {
  const { url, key } = await discover();
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${url}/rest/v1/garbage_reports?select=${COLUMNS}&moderation_status=eq.approved&order=created_at.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, "Range-Unit": "items" } },
    );
    if (!res.ok && res.status !== 206) throw new Error(`NammaKasa HTTP ${res.status}`);
    const page = (await res.json()) as NammaKasaRow[];
    rows.push(...page);
    console.log(`fetched ${rows.length}`);
    if (page.length < 1000) break;
    await sleep(1000);
  }
  writeFileSync(process.env.NK_RAW_OUT ?? "/tmp/nammakasa-raw.json", JSON.stringify(rows));
}

const mapped = rows.map(mapNammaKasa).filter((m): m is NonNullable<typeof m> => m !== null);
console.log(`${rows.length} fetched, ${mapped.length} mappable (inside the 369 wards, with a photo)`);
if (dry) process.exit(0);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
for (let i = 0; i < mapped.length; i += 500) {
  const { error } = await db.from("reports").upsert(mapped.slice(i, i + 500), { onConflict: "source,source_id" });
  if (error) throw new Error(error.message);
}

// Live subset: recent, unresolved, and not duplicating a CleanLoop pin.
const { data: ours } = await db.from("reports").select("lat, lng").eq("source", "cleanloop");
const cutoff = Date.now() - 90 * 86_400_000;
const show = mapped.filter(
  (m) =>
    m.status === "open" &&
    Date.parse(m.created_at) >= cutoff &&
    !(ours ?? []).some((o) => haversineMetres(o.lat, o.lng, m.lat, m.lng) <= 50),
).map((m) => m.source_id);
await db.from("reports").update({ is_public: false }).eq("source", "nammakasa");
for (let i = 0; i < show.length; i += 300) {
  await db.from("reports").update({ is_public: true }).eq("source", "nammakasa").in("source_id", show.slice(i, i + 300));
}
console.log(`upserted ${mapped.length}; ${show.length} shown live on the map`);
