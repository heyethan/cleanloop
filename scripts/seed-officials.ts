/**
 * Load the reviewed officials list into the `officials` table, rehosting official photos.
 *
 *   infisical run ... -- node --experimental-strip-types scripts/seed-officials.ts [--dry-run]
 *
 * Source: src/data/officials.csv (researched 2026-10-02 from gba.karnataka.gov.in, the five
 * corporation sites and named news reports; every row keeps its source_url). Rows marked
 * confidence=low are skipped: a wrong name and face on a public accountability page is worse
 * than escalating one level up. Photos are copied into the storage bucket so the page never
 * hotlinks a government server; the original page stays in photo_source_page/source_url.
 * Idempotent: replaces the whole table each run.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const dry = process.argv.includes("--dry-run");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : null);

const rows = parseCsv(readFileSync("src/data/officials.csv", "utf8")).filter((r) => r.confidence !== "low" && r.name);
const out = [];
for (const r of rows) {
  let photo: string | null = null;
  if (r.photo_url && !dry) {
    // curl, not fetch: the GBA sites serve an incomplete TLS chain that Node rejects
    // (UNABLE_TO_VERIFY_LEAF_SIGNATURE) while curl completes it. Verification stays on either way.
    let bytes: Buffer | null = null;
    try {
      bytes = execFileSync("curl", ["-sSf", "-m", "20", r.photo_url], { maxBuffer: 10 * 1024 * 1024 });
    } catch {
      bytes = null;
    }
    const ext = /\.(png|jpe?g|webp)$/i.exec(r.photo_url)?.[1]?.toLowerCase().replace("jpeg", "jpg");
    const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const res = bytes && bytes.length > 500 ? { ok: true, status: 200 } : { ok: false, status: bytes?.length ?? 0 };
    if (res.ok && bytes) {
      const path = `officials/${r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${ext ?? "jpg"}`;
      const { error } = await db.storage.from("cleanloop").upload(path, bytes, { contentType: type, upsert: true });
      if (!error) photo = db.storage.from("cleanloop").getPublicUrl(path).data.publicUrl;
      else console.log("photo upload failed:", r.name, error.message);
    } else console.log("photo fetch failed:", r.name, res?.status);
  }
  out.push({
    level: r.level,
    ward_id: r.ward_id || null,
    zone: r.zone || null,
    corporation: cap(r.corporation),
    category: r.category,
    role: r.role,
    name: r.name,
    photo_url: photo,
    email: r.email || null,
    source_url: r.source_url || r.photo_source_page || null,
    verified_at: new Date().toISOString(),
  });
}

console.log(`${dry ? "[dry-run] " : ""}${out.length} officials (${rows.length} kept of csv), ${out.filter((o) => o.photo_url).length} photos rehosted`);
if (!dry) {
  const { error: delErr } = await db.from("officials").delete().gte("id", 0);
  if (delErr) throw delErr;
  const { error } = await db.from("officials").insert(out);
  if (error) throw error;
}
