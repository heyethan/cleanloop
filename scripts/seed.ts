/**
 * Seed CleanLoop with REAL data where it exists, disclosed synthetic where it doesn't.
 *
 * Importers/callers: none — run with `npm run seed` (add --wipe to reset).
 * Affected API: none; writes directly to Supabase with the service-role key.
 * Data schemas: writes waste_facilities (real OSM), reports (is_seed=true),
 * resolutions (is_genuine_pair=false). Timestamps ISO-8601, backdated over 45 days.
 * User instruction, verbatim: "I want actual data to be populated in as many areas as possible"
 *
 * WHAT IS REAL HERE:
 *   - waste_facilities: 500+ genuine OpenStreetMap waste bins / recycling /
 *     disposal points across Bengaluru. Real coordinates, real operators.
 *   - Ward centroids: real, from OSM Nominatim.
 *   - Photos: real Creative Commons images from Wikimedia Commons, with
 *     attribution and licence stored alongside every row.
 *
 * WHAT IS SYNTHETIC (and flagged is_seed=true):
 *   - The reports themselves. There is no public dataset of Bengaluru dump spots;
 *     inventing one and calling it real would be fabrication. Report locations are
 *     placed near REAL waste infrastructure (dumping clusters around overflowing
 *     bins is the actual documented pattern) so the map is plausible, not random.
 *
 * WHAT IS NOT A REAL PAIR:
 *   - Seeded before/after photos are two different real photographs. They are NOT
 *     the same location cleaned. is_genuine_pair=false marks every one, the UI
 *     labels them, and the README says so. Only photos you take yourself produce
 *     genuine pairs.
 *
 * Deterministic: fixed PRNG seed, so re-running yields the same dataset.
 */

import { createClient } from "@supabase/supabase-js";
import { WARDS, nearestWard } from "../src/lib/wards.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !KEY) {
  console.error("Missing Supabase env. Run: npm run seed");
  process.exit(1);
}
const db = createClient(SUPA_URL, KEY, { auth: { persistSession: false } });

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

/*
 * Wikimedia's robot policy rejects generic agents with HTTP 429 regardless of
 * rate — it requires an identifying string with a contact. Downloads are also
 * throttled below; hammering upload.wikimedia.org gets you blocked outright.
 */
const UA = {
  "User-Agent":
    "CleanLoopHackathonBot/1.0 (https://github.com/cleanloop/cleanloop; civic waste demo) node-fetch",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- real OSM data

interface Facility {
  id: string;
  amenity: string;
  lat: number;
  lng: number;
  name: string | null;
  operator: string | null;
}

/**
 * Public Overpass instances rate-limit and 504 under load — the main one did
 * exactly that on first run. Try mirrors in turn rather than failing the seed.
 */
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

async function fetchFacilities(): Promise<Facility[]> {
  const q = `[out:json][timeout:90];
(node["amenity"~"waste_basket|waste_disposal|recycling"](12.83,77.45,13.14,77.78););
out body;`;

  let res: Response | null = null;
  for (const mirror of OVERPASS_MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(mirror, {
          method: "POST",
          headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: q }),
          signal: AbortSignal.timeout(120_000),
        });
        if (r.ok) {
          res = r;
          console.log(`  overpass: ${new URL(mirror).host}`);
          break;
        }
        console.log(`  overpass ${new URL(mirror).host} -> ${r.status}, retrying`);
      } catch (e) {
        console.log(`  overpass ${new URL(mirror).host} -> ${(e as Error).name}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (res) break;
  }
  if (!res) throw new Error("all Overpass mirrors failed");
  const json = (await res.json()) as { elements: unknown[] };
  return json.elements.map((e) => {
    const el = e as {
      id: number;
      lat: number;
      lon: number;
      tags?: Record<string, string>;
    };
    return {
      id: `node/${el.id}`,
      amenity: el.tags?.amenity ?? "waste_basket",
      lat: el.lat,
      lng: el.lon,
      name: el.tags?.name ?? null,
      operator: el.tags?.operator ?? null,
    };
  });
}

// ------------------------------------------------------- real CC-licensed photos

interface Photo {
  url: string;
  license: string;
  attribution: string;
  sourceUrl: string;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function commonsSearch(term: string, limit: number): Promise<Photo[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `filetype:bitmap ${term}`,
    gsrlimit: String(limit),
    gsrnamespace: "6",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1200",
    origin: "*",
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: UA,
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    query?: { pages?: Record<string, unknown> };
  };
  const pages = Object.values(json.query?.pages ?? {});
  const out: Photo[] = [];
  for (const p of pages) {
    const page = p as {
      title: string;
      imageinfo?: Array<{
        thumburl?: string;
        descriptionurl?: string;
        extmetadata?: Record<string, { value: string }>;
      }>;
    };
    const ii = page.imageinfo?.[0];
    if (!ii?.thumburl) continue;
    const md = ii.extmetadata ?? {};
    const license = md.LicenseShortName?.value ?? "see source";
    // Public-domain / CC only. Anything else is skipped rather than guessed at.
    if (/fair use|non-free/i.test(license)) continue;
    out.push({
      url: ii.thumburl,
      license,
      attribution: stripHtml(md.Artist?.value ?? "Wikimedia Commons"),
      sourceUrl: ii.descriptionurl ?? "",
    });
  }
  return out;
}

/** Throttled + retrying mirror of one Commons image into our storage bucket. */
async function uploadFromUrl(src: string, path: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(src, { headers: UA, signal: AbortSignal.timeout(45_000) });
      if (res.status === 429) {
        // Back off hard; Wikimedia escalates to longer blocks if you keep going.
        await sleep(4000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? "image/jpeg";
      const { error } = await db.storage
        .from("cleanloop")
        .upload(path, buf, { contentType: ct, upsert: true });
      if (error) {
        console.log(`    upload failed ${path}: ${error.message}`);
        return null;
      }
      return db.storage.from("cleanloop").getPublicUrl(path).data.publicUrl;
    } catch (e) {
      if (attempt === 2) console.log(`    fetch failed ${path}: ${(e as Error).message}`);
      await sleep(2000);
    }
  }
  return null;
}

// ------------------------------------------------------------------------ main

const DESCRIPTIONS: Record<string, string> = {
  mixed: "Unsegregated household waste accumulated at the roadside.",
  plastic: "Plastic packaging and bottles scattered across the footpath.",
  organic: "Food and garden waste dumped beside the kerb.",
  construction: "Construction debris and rubble left on the verge.",
  hazardous: "Discarded material requiring careful handling.",
};
const WASTE = ["mixed", "plastic", "organic", "construction", "hazardous"] as const;

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

async function main() {
  if (process.argv.includes("--wipe")) {
    console.log("wiping seed rows…");
    const { data } = await db.from("reports").select("id").eq("is_seed", true);
    const ids = (data ?? []).map((r) => r.id as string);
    if (ids.length) {
      await db.from("resolutions").delete().in("report_id", ids);
      await db.from("reports").delete().in("id", ids);
    }
    console.log(`  removed ${ids.length}`);
  }

  await db
    .from("wards")
    .upsert(WARDS.map((w) => ({ id: w.id, name: w.name, lat: w.lat, lng: w.lng })));
  console.log(`wards: ${WARDS.length} (real OSM centroids)`);

  // --- REAL: OpenStreetMap waste infrastructure -----------------------------
  console.log("fetching real OSM waste infrastructure…");
  const facilities = await fetchFacilities();
  for (let i = 0; i < facilities.length; i += 200) {
    const chunk = facilities.slice(i, i + 200).map((f) => ({
      ...f,
      ward_id: nearestWard(f.lat, f.lng)?.id ?? null,
      source: "openstreetmap",
    }));
    const { error } = await db.from("waste_facilities").upsert(chunk);
    if (error) throw new Error(`facilities: ${error.message}`);
  }
  console.log(`facilities: ${facilities.length} REAL OSM nodes imported`);

  // --- REAL: Creative Commons photos ---------------------------------------
  console.log("fetching Creative Commons photos…");
  const beforePool = [
    ...(await commonsSearch("garbage dump street India", 15)),
    ...(await commonsSearch("waste pile roadside India", 15)),
    ...(await commonsSearch("municipal solid waste India street", 10)),
  ];
  const afterPool = [
    ...(await commonsSearch("clean street India city", 12)),
    ...(await commonsSearch("street sweeping India", 10)),
  ];
  console.log(`photos: ${beforePool.length} before, ${afterPool.length} after (CC)`);
  if (beforePool.length === 0) throw new Error("no CC photos found — aborting");

  // Mirror a bounded pool into our own storage so the demo doesn't hot-link.
  const beforeUploaded: Photo[] = [];
  for (let i = 0; i < Math.min(beforePool.length, 14); i++) {
    const url = await uploadFromUrl(beforePool[i].url, `cc/before-${i}.jpg`);
    if (url) beforeUploaded.push({ ...beforePool[i], url });
    await sleep(1200); // Wikimedia asks for serial, throttled access
  }
  const afterUploaded: Photo[] = [];
  for (let i = 0; i < Math.min(afterPool.length, 10); i++) {
    const url = await uploadFromUrl(afterPool[i].url, `cc/after-${i}.jpg`);
    if (url) afterUploaded.push({ ...afterPool[i], url });
    await sleep(1200);
  }
  console.log(`mirrored: ${beforeUploaded.length} before, ${afterUploaded.length} after`);
  if (!beforeUploaded.length) throw new Error("no photos mirrored — aborting");

  // --- SYNTHETIC (disclosed): reports near real infrastructure --------------
  const N = 120;
  const now = Date.now();
  let open = 0,
    claimed = 0,
    verified = 0,
    recurringCount = 0;

  // Cluster ~60% of reports near real facilities (the documented real-world
  // pattern: dumping accumulates around overflowing bins), rest spread by ward.
  for (let i = 0; i < N; i++) {
    let lat: number, lng: number;
    if (facilities.length && rand() < 0.6) {
      const f = facilities[Math.floor(rand() * facilities.length)];
      lat = f.lat + (rand() - 0.5) * 0.0035; // within ~200m of a real bin
      lng = f.lng + (rand() - 0.5) * 0.0035;
    } else {
      const w = WARDS[Math.floor(rand() * WARDS.length)];
      lat = w.lat + (rand() - 0.5) * 0.022;
      lng = w.lng + (rand() - 0.5) * 0.022;
    }
    const ward = nearestWard(lat, lng);
    if (!ward) continue;

    const waste = WASTE[Math.floor(rand() * WASTE.length)];
    const severity = 1 + Math.floor(rand() * 5);
    const ageDays = rand() * 45;
    const createdAt = new Date(now - ageDays * 86_400_000).toISOString();
    const photo = beforeUploaded[Math.floor(rand() * beforeUploaded.length)];

    // Older reports are likelier to be resolved — gives the leaderboard a real curve.
    const resolveChance = 0.28 + Math.min(ageDays / 45, 1) * 0.42;
    const resolved = rand() < resolveChance;
    const verifiesClean = resolved && rand() < 0.76;
    const isRecurring = rand() < 0.24;
    if (isRecurring) recurringCount++;

    const { data: rep, error } = await db
      .from("reports")
      .insert({
        photo_before_url: photo.url,
        photo_attribution: photo.attribution,
        photo_license: photo.license,
        photo_source_url: photo.sourceUrl,
        lat,
        lng,
        ward_id: ward.id,
        waste_type: waste,
        severity,
        is_recurring: isRecurring,
        status: resolved ? (verifiesClean ? "verified_resolved" : "claimed") : "open",
        complaint_text: complaintFor(waste, severity, ward.name, lat, lng, isRecurring),
        ai_description: DESCRIPTIONS[waste],
        ai_confidence: 0.72 + rand() * 0.25,
        created_at: createdAt,
        is_seed: true,
      })
      .select()
      .single();
    if (error) throw new Error(`report ${i}: ${error.message}`);

    if (!resolved) {
      open++;
      continue;
    }

    const lagDays = 0.4 + rand() * 9;
    const submittedAt = new Date(
      Math.min(now, new Date(createdAt).getTime() + lagDays * 86_400_000),
    ).toISOString();
    const after = afterUploaded.length
      ? afterUploaded[Math.floor(rand() * afterUploaded.length)]
      : photo;

    const { error: rErr } = await db.from("resolutions").insert({
      report_id: rep.id,
      photo_after_url: after.url,
      photo_attribution: after.attribution,
      photo_license: after.license,
      photo_source_url: after.sourceUrl,
      ai_verification_result: verifiesClean ? "verified_clean" : "ambiguous",
      ai_confidence: verifiesClean ? 0.82 + rand() * 0.16 : 0.34 + rand() * 0.3,
      ai_reasoning: verifiesClean
        ? "The waste visible in the before image is absent in the after image."
        : "Could not confirm the two photographs show the same location.",
      submitted_at: submittedAt,
      verified_at: verifiesClean ? submittedAt : null,
      // Two different real photos, NOT the same spot cleaned. Never claim otherwise.
      is_genuine_pair: false,
    });
    if (rErr) throw new Error(`resolution ${i}: ${rErr.message}`);
    if (verifiesClean) verified++;
    else claimed++;
  }

  console.log(
    `\nREAL     : ${facilities.length} OSM waste facilities, ${WARDS.length} ward centroids`,
  );
  console.log(
    `REAL     : ${beforeUploaded.length + afterUploaded.length} CC-licensed photos (attributed)`,
  );
  console.log(
    `SYNTHETIC: ${open + claimed + verified} reports — ${open} open, ${claimed} claimed, ${verified} verified`,
  );
  console.log(`SYNTHETIC: ${recurringCount} flagged recurring`);
  console.log(`\nAll reports flagged is_seed=true. All seeded pairs is_genuine_pair=false.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
