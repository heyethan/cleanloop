/**
 * Seed synthetic demo data — spec §8 risk #5.
 *
 * Importers/callers: none — run with `npm run seed`.
 * Affected API: none; writes directly to Supabase with the service-role key.
 * Data schemas: inserts `reports` (is_seed=true) and `resolutions`. created_at /
 * submitted_at / verified_at are ISO-8601 strings backdated across the last 30 days.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * EVERY ROW IS SYNTHETIC and flagged is_seed=true so the UI can label it and the pitch can
 * disclose it honestly. Photos are generated placeholder images, not real Bengaluru dumps.
 * Seeded AI fields are precomputed constants — no model is called here.
 *
 * Deterministic: a fixed PRNG seed means re-running produces the same dataset.
 */

import { createClient } from "@supabase/supabase-js";
import { WARDS } from "../src/lib/wards.ts";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with: node --experimental-strip-types --env-file=.env.local scripts/seed.ts",
  );
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

/** Mulberry32 — small deterministic PRNG so seed runs are reproducible. */
function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260822);

const WASTE = ["mixed", "plastic", "organic", "construction", "hazardous"] as const;

const DESCRIPTIONS: Record<string, string> = {
  mixed: "Unsegregated household waste accumulated at the roadside.",
  plastic: "Plastic packaging and bottles scattered across the footpath.",
  organic: "Food and garden waste dumped beside the kerb.",
  construction: "Construction debris and rubble left on the verge.",
  hazardous: "Discarded material requiring careful handling.",
};

function complaintFor(
  waste: string,
  severity: number,
  wardName: string,
  lat: number,
  lng: number,
  recurring: boolean,
) {
  return (
    `An accumulation of ${waste} waste has been observed at ${wardName}, Bengaluru ` +
    `(${lat.toFixed(5)}, ${lng.toFixed(5)}). The accumulation is assessed at severity ` +
    `${severity} of 5 based on visible volume and spread.` +
    (recurring
      ? " This location has been reported previously and the issue has recurred."
      : "") +
    " Requesting inspection and clearance by the concerned ward office."
  );
}

/** Tiny valid PNGs — enough to stand in for a photo without shipping binaries. */
function placeholderPng(kind: "before" | "after"): Uint8Array {
  const BEFORE =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const AFTER =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  return Uint8Array.from(Buffer.from(kind === "before" ? BEFORE : AFTER, "base64"));
}

async function uploadSeedPhoto(kind: "before" | "after", i: number): Promise<string> {
  const path = `seed/${kind}-${i}.png`;
  const { error } = await db.storage
    .from("cleanloop")
    .upload(path, placeholderPng(kind), { contentType: "image/png", upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
  return db.storage.from("cleanloop").getPublicUrl(path).data.publicUrl;
}

async function main() {
  const wipe = process.argv.includes("--wipe");
  if (wipe) {
    console.log("wiping existing seed rows…");
    const { data: seedIds } = await db.from("reports").select("id").eq("is_seed", true);
    const ids = (seedIds ?? []).map((r) => r.id as string);
    if (ids.length) {
      await db.from("resolutions").delete().in("report_id", ids);
      await db.from("reports").delete().in("id", ids);
    }
    console.log(`  removed ${ids.length} seed reports`);
  }

  await db
    .from("wards")
    .upsert(WARDS.map((w) => ({ id: w.id, name: w.name, lat: w.lat, lng: w.lng })));
  console.log(`wards upserted: ${WARDS.length}`);

  const N = 46;
  const now = Date.now();
  let created = 0;
  let verified = 0;
  let claimed = 0;

  for (let i = 0; i < N; i++) {
    const ward = WARDS[Math.floor(rand() * WARDS.length)];
    // Jitter within roughly 1.5km of the locality centroid.
    const lat = ward.lat + (rand() - 0.5) * 0.025;
    const lng = ward.lng + (rand() - 0.5) * 0.025;
    const waste = WASTE[Math.floor(rand() * WASTE.length)];
    const severity = 1 + Math.floor(rand() * 5);
    const ageDays = rand() * 30;
    const createdAt = new Date(now - ageDays * 86_400_000).toISOString();

    // ~55% get resolved; of those most verify clean, some land ambiguous (yellow).
    const roll = rand();
    const resolved = roll < 0.55;
    const verifiesClean = resolved && rand() < 0.78;

    const beforeUrl = await uploadSeedPhoto("before", i);

    const { data: rep, error } = await db
      .from("reports")
      .insert({
        photo_before_url: beforeUrl,
        lat,
        lng,
        ward_id: ward.id,
        waste_type: waste,
        severity,
        is_recurring: rand() < 0.22,
        status: resolved ? (verifiesClean ? "verified_resolved" : "claimed") : "open",
        complaint_text: complaintFor(waste, severity, ward.name, lat, lng, false),
        ai_description: DESCRIPTIONS[waste],
        ai_confidence: 0.72 + rand() * 0.25,
        created_at: createdAt,
        reporter_session_id: null,
        is_seed: true,
      })
      .select()
      .single();
    if (error) throw new Error(`insert report ${i}: ${error.message}`);
    created++;

    if (resolved) {
      // Cleanup happens 0.5-9 days after the report, never before it.
      const lagDays = 0.5 + rand() * 8.5;
      const submittedAt = new Date(
        Math.min(now, new Date(createdAt).getTime() + lagDays * 86_400_000),
      ).toISOString();
      const afterUrl = await uploadSeedPhoto("after", i);

      const { error: rErr } = await db.from("resolutions").insert({
        report_id: rep.id,
        photo_after_url: afterUrl,
        ai_verification_result: verifiesClean ? "verified_clean" : "ambiguous",
        ai_confidence: verifiesClean ? 0.82 + rand() * 0.16 : 0.35 + rand() * 0.3,
        ai_reasoning: verifiesClean
          ? "The waste visible in the before image is absent in the after image."
          : "Could not confirm the two photos show the same location.",
        submitted_at: submittedAt,
        verified_at: verifiesClean ? submittedAt : null,
        resolver_session_id: null,
        is_self_resolved: false,
      });
      if (rErr) throw new Error(`insert resolution ${i}: ${rErr.message}`);
      if (verifiesClean) verified++;
      else claimed++;
    }
  }

  console.log(
    `\nseeded ${created} reports — ${verified} verified green, ${claimed} claimed yellow, ` +
      `${created - verified - claimed} open red`,
  );
  console.log("all rows flagged is_seed=true and are synthetic.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
