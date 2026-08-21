/**
 * Curated Creative Commons photo pipeline — category-sourced, human-reviewed.
 *
 * Importers/callers: none at runtime. Run with:
 *   npm run photos:candidates   -> fetch candidates + write a review contact sheet
 * Affected API: none.
 * Data: reads Commons categorymembers + imageinfo. Writes photo-candidates.json
 * ({file, url, license, attribution, sourceUrl, category, kind}) and photo-review.html.
 * No dates, no personal data stored.
 * User instruction, verbatim: "2. sort out the image seeding issue"
 *
 * WHY THIS REPLACES THE SEED'S PHOTO STEP:
 *   scripts/seed.ts sourced photos with free-text Commons search
 *   (`commonsSearch("garbage dump street India")`). A visual audit of all 28 images that
 *   actually shipped found roughly TWO usable ones. The rest were a vulture, a brass pot,
 *   a 3D city model, Jama Masjid, a black-and-white historical street, a hillside, a
 *   railway platform — plus three junk test uploads including a screenshot of a code
 *   editor, and three photographs of identifiable private individuals' faces.
 *
 *   Free-text relevance ranking on Commons optimises for term match, not subject matter.
 *   Categories are curated BY HUMANS for subject matter, which is exactly the property we
 *   need. They are still noisy, so this script does not auto-approve anything: it emits a
 *   contact sheet, and only files a human has looked at are ever uploaded.
 *
 * THE REVIEW RULE, because it is the actual point:
 *   Reject any image with an identifiable face. These are real people who did not consent
 *   to appear in a demo, and the site is public. Reject anything that is not plainly a
 *   waste site (for `before`) or a plainly clean public street (for `after`).
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_JSON = join(HERE, "..", "photo-candidates.json");
const OUT_HTML = join(HERE, "..", "photo-review.html");

/** Wikimedia rejects generic agents with 429 regardless of rate. Identify + throttle. */
const UA = {
  "User-Agent":
    "CleanLoopHackathonBot/1.0 (https://github.com/heyethan/cleanloop; civic waste demo) node-fetch",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Candidate {
  file: string;
  url: string;
  license: string;
  attribution: string;
  sourceUrl: string;
  category: string;
  kind: "before" | "after";
}

/**
 * Human-curated Commons categories. `before` categories are waste sites; `after`
 * categories are ordinary clean streetscapes.
 */
const CATEGORIES: { name: string; kind: "before" | "after" }[] = [
  { name: "Category:Waste in India", kind: "before" },
  { name: "Category:Garbage in India", kind: "before" },
  { name: "Category:Waste containers in India", kind: "before" },
  { name: "Category:Landfills in India", kind: "before" },
  { name: "Category:Waste management in India", kind: "before" },
  { name: "Category:Litter", kind: "before" },
  { name: "Category:Illegal dumping", kind: "before" },
  /*
   * "Bangalore" returns ZERO files — Commons categorises the city as "Bengaluru".
   * "Category:Street cleaning" was also tried and dropped: it is almost entirely
   * historical engravings, European sweepers, WWII-era photographs and school children,
   * with essentially nothing that reads as a clean Indian street.
   */
  { name: "Category:Streets in Bengaluru", kind: "after" },
  { name: "Category:Roads in Bengaluru", kind: "after" },
  { name: "Category:Streets in Karnataka", kind: "after" },
  { name: "Category:Roads in Karnataka", kind: "after" },
];

async function categoryFiles(category: string, limit = 40): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    list: "categorymembers",
    cmtitle: category,
    cmtype: "file",
    cmlimit: String(limit),
    origin: "*",
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: UA,
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    query?: { categorymembers?: { title: string }[] };
  };
  return (json.query?.categorymembers ?? []).map((m) => m.title);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

async function imageInfo(
  titles: string[],
): Promise<Omit<Candidate, "category" | "kind">[]> {
  const out: Omit<Candidate, "category" | "kind">[] = [];
  // The API caps titles per request; 20 is comfortably under it.
  for (let i = 0; i < titles.length; i += 20) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      titles: titles.slice(i, i + 20).join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata|mime",
      iiurlwidth: "1200",
      origin: "*",
    });
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: UA,
    });
    if (!res.ok) continue;
    const json = (await res.json()) as { query?: { pages?: Record<string, unknown> } };
    for (const p of Object.values(json.query?.pages ?? {})) {
      const page = p as {
        title: string;
        imageinfo?: Array<{
          thumburl?: string;
          descriptionurl?: string;
          mime?: string;
          extmetadata?: Record<string, { value: string }>;
        }>;
      };
      const ii = page.imageinfo?.[0];
      if (!ii?.thumburl) continue;
      // Bitmaps only — SVG diagrams and PDFs are not photographs of anything.
      if (ii.mime && !/^image\/(jpeg|png|webp)$/.test(ii.mime)) continue;
      const md = ii.extmetadata ?? {};
      const license = md.LicenseShortName?.value ?? "see source";
      if (/fair use|non-free/i.test(license)) continue;
      out.push({
        file: page.title.replace(/^File:/, ""),
        url: ii.thumburl,
        license,
        attribution: stripHtml(md.Artist?.value ?? "Wikimedia Commons"),
        sourceUrl: ii.descriptionurl ?? "",
      });
    }
    await sleep(1200);
  }
  return out;
}

async function candidates() {
  const all: Candidate[] = [];
  const seen = new Set<string>();

  for (const cat of CATEGORIES) {
    process.stdout.write(`- ${cat.name} … `);
    const titles = await categoryFiles(cat.name);
    const infos = await imageInfo(titles);
    let added = 0;
    for (const info of infos) {
      if (seen.has(info.file)) continue;
      seen.add(info.file);
      all.push({ ...info, category: cat.name, kind: cat.kind });
      added++;
    }
    console.log(`${titles.length} files, ${added} usable`);
    await sleep(1200);
  }

  writeFileSync(OUT_JSON, JSON.stringify(all, null, 2));

  const cell = (c: Candidate, i: number) =>
    `<figure><img src="${c.url}" loading="eager"><figcaption>` +
    `<b>#${i}</b> [${c.kind}] ${c.file.slice(0, 46)}</figcaption></figure>`;
  writeFileSync(
    OUT_HTML,
    `<!doctype html><meta charset=utf-8><title>photo review</title><style>
body{background:#111;color:#eee;font:12px system-ui;margin:0;padding:10px}
h2{font-size:14px;margin:16px 0 6px}
main{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
figure{margin:0}img{width:100%;height:165px;object-fit:cover;border-radius:6px;display:block;background:#333}
figcaption{padding:4px 0;font-size:10.5px;color:#9ab;line-height:1.3}</style>
<h2>BEFORE candidates (must be plainly a waste site, no identifiable faces)</h2>
<main>${all
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.kind === "before")
      .map(({ c, i }) => cell(c, i))
      .join("")}</main>
<h2>AFTER candidates (must be a plainly clean public street, no identifiable faces)</h2>
<main>${all
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.kind === "after")
      .map(({ c, i }) => cell(c, i))
      .join("")}</main>`,
  );

  console.log(`\n${all.length} candidates -> ${OUT_JSON}`);
  console.log(`review sheet -> ${OUT_HTML}`);
  console.log("Nothing is uploaded until a human has reviewed this sheet.");
}

/**
 * APPROVED — indices into photo-candidates.json that a human has LOOKED AT on the contact
 * sheet and confirmed. Reviewed 2026-08-21 against the rule above.
 *
 * Rejected during that review, for the record: every image containing an identifiable
 * face (officials at a launch, schoolchildren, a woman holding a sign, workers cooking),
 * plus animal close-ups, conference posters, engravings, a brass pot, a 3D city model,
 * Jama Masjid, and the entire "Street cleaning" category, which turned out to be mostly
 * historical European material.
 *
 * These are indices, so they are only valid for the candidates file they were reviewed
 * against. Re-run `photos:candidates` and the indices shift — re-review before applying.
 */
const APPROVED_BEFORE = [0, 4, 5, 8, 11, 12, 20, 22, 35, 45, 57, 58, 59, 60, 62, 63, 64];
const APPROVED_AFTER = [
  156, 157, 158, 179, 182, 183, 191, 199, 201, 202, 203, 206, 207, 208, 210, 211,
];

async function apply() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing Supabase env — run via npm run photos:apply");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const all = JSON.parse(
    (await import("node:fs")).readFileSync(OUT_JSON, "utf8"),
  ) as Candidate[];

  /** Mirror one Commons image into our bucket and return its public URL. */
  async function mirror(c: Candidate, path: string): Promise<string | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(c.url.split("?")[0], {
          headers: UA,
          signal: AbortSignal.timeout(45_000),
        });
        if (res.status === 429) {
          await sleep(4000 * (attempt + 1));
          continue;
        }
        if (!res.ok) return null;
        const buf = new Uint8Array(await res.arrayBuffer());
        const { error } = await db.storage
          .from("cleanloop")
          .upload(path, buf, {
            contentType: res.headers.get("content-type") ?? "image/jpeg",
            upsert: true,
          });
        if (error) {
          console.log(`  upload failed ${path}: ${error.message}`);
          return null;
        }
        return db.storage.from("cleanloop").getPublicUrl(path).data.publicUrl;
      } catch {
        await sleep(1500);
      }
    }
    return null;
  }

  async function upload(indices: number[], kind: "before" | "after") {
    const out: { url: string; c: Candidate }[] = [];
    for (const [n, idx] of indices.entries()) {
      const c = all[idx];
      if (!c) {
        console.log(`  index ${idx} not in candidates file — skipped`);
        continue;
      }
      const url = await mirror(c, `curated-${kind}-${n}.jpg`);
      if (url) out.push({ url, c });
      process.stdout.write(url ? "." : "x");
      await sleep(400);
    }
    console.log(` ${out.length}/${indices.length} ${kind}`);
    return out;
  }

  console.log("mirroring approved photos…");
  const before = await upload(APPROVED_BEFORE, "before");
  const after = await upload(APPROVED_AFTER, "after");
  if (!before.length) throw new Error("no before photos mirrored — aborting");

  // Repoint every report. This also clears the junk test uploads, which are simply
  // rows pointing at a URL nobody curated.
  const { data: reports } = await db.from("reports").select("id").order("id");
  let n = 0;
  for (const [i, r] of (reports ?? []).entries()) {
    const pick = before[i % before.length];
    const { error } = await db
      .from("reports")
      .update({
        photo_before_url: pick.url,
        photo_attribution: pick.c.attribution,
        photo_license: pick.c.license,
      })
      .eq("id", r.id);
    if (!error) n++;
  }
  console.log(`repointed ${n} reports`);

  let m = 0;
  if (after.length) {
    const { data: res } = await db.from("resolutions").select("id").order("id");
    for (const [i, row] of (res ?? []).entries()) {
      const pick = after[i % after.length];
      const { error } = await db
        .from("resolutions")
        .update({ photo_after_url: pick.url })
        .eq("id", row.id);
      if (!error) m++;
    }
  }
  console.log(`repointed ${m} resolutions`);
  console.log("\nAll photos are CC-licensed, attributed, and human-reviewed.");
}

const mode = process.argv[2] ?? "candidates";
if (mode === "candidates") {
  await candidates();
} else if (mode === "apply") {
  await apply();
} else {
  console.error(`unknown mode "${mode}" — use: candidates | apply`);
  process.exit(1);
}
