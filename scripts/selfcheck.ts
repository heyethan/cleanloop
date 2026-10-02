/**
 * Minimal self-check for CleanLoop's non-trivial pure logic.
 *
 * Importers/callers: none — run directly with `npm run selfcheck`
 * (node --experimental-strip-types scripts/selfcheck.ts).
 * Affected API: none, test-only.
 * Data schemas: none, no file I/O.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * Covers the geo math behind recurring-spot detection and the verification threshold that
 * decides green vs yellow. Deliberately no test framework — assert only.
 */

import assert from "node:assert/strict";
import { splitSql } from "./sql-split.ts";
import { nextStatus } from "../src/lib/lifecycle.ts";
import { haversineMetres, nearestWard, wardName, WARDS } from "../src/lib/wards.ts";
import { wardAt, wardMeta } from "../src/lib/gbaWards.ts";
import { pickOfficial, type Official } from "../src/lib/officials.ts";
import { signAction, verifyAction } from "../src/lib/actionToken.ts";
import { isReporter, hashCode } from "../src/lib/reporter.ts";
import {
  statusFromVerification,
  stubProvider,
  VERIFY_CONFIDENCE_THRESHOLD,
} from "../src/lib/ai.ts";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}
async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log("  ok -", name);
}

console.log("geo:");

check("haversine: zero distance", () => {
  assert.equal(haversineMetres(12.9357, 77.6241, 12.9357, 77.6241), 0);
});

check("haversine: ~111m per 0.001 deg latitude", () => {
  const d = haversineMetres(12.9357, 77.6241, 12.9367, 77.6241);
  assert.ok(d > 105 && d < 118, `expected ~111m, got ${d}`);
});

check("haversine: Koramangala->Indiranagar is 4-6 km", () => {
  const d = haversineMetres(12.9357366, 77.624081, 12.9732913, 77.6404672);
  assert.ok(d > 4000 && d < 6000, `expected 4-6km, got ${d}`);
});

check("haversine is symmetric", () => {
  const a = haversineMetres(12.91, 77.61, 13.0, 77.7);
  const b = haversineMetres(13.0, 77.7, 12.91, 77.61);
  assert.ok(Math.abs(a - b) < 1e-6);
});

console.log("wards:");

check("nearestWard: exact centroid returns that ward", () => {
  assert.equal(nearestWard(12.9357366, 77.624081)?.id, "koramangala");
});

check("nearestWard: a point 300m off still resolves to the same ward", () => {
  assert.equal(nearestWard(12.9384, 77.624081)?.id, "koramangala");
});

check("nearestWard: far-away point returns null, not a wrong ward", () => {
  // Mumbai — must not be assigned to a Bengaluru locality.
  assert.equal(nearestWard(19.076, 72.8777), null);
});

check("wardName round-trips, unknown id is null", () => {
  assert.equal(wardName("hsr-layout"), "HSR Layout");
  assert.equal(wardName("does-not-exist"), null);
  assert.equal(wardName(null), null);
});

check("ward ids are unique", () => {
  assert.equal(new Set(WARDS.map((w) => w.id)).size, WARDS.length);
});

check("all ward coords are plausibly in Bengaluru", () => {
  for (const w of WARDS) {
    assert.ok(w.lat > 12.7 && w.lat < 13.3, `${w.id} lat out of range`);
    assert.ok(w.lng > 77.3 && w.lng < 77.9, `${w.id} lng out of range`);
  }
});

console.log("verification threshold:");

check("high-confidence clean waits for the reporter (awaiting_confirmation)", () => {
  assert.equal(
    statusFromVerification({ result: "verified_clean", confidence: 0.95, reasoning: "" }),
    "awaiting_confirmation",
  );
});

check("low-confidence clean stays claimed (yellow), never green", () => {
  assert.equal(
    statusFromVerification({ result: "verified_clean", confidence: 0.5, reasoning: "" }),
    "claimed",
  );
});

check("not_clean never goes green even at high confidence", () => {
  assert.equal(
    statusFromVerification({ result: "not_clean", confidence: 0.99, reasoning: "" }),
    "claimed",
  );
});

check("ambiguous never goes green even at high confidence", () => {
  assert.equal(
    statusFromVerification({ result: "ambiguous", confidence: 0.99, reasoning: "" }),
    "claimed",
  );
});

check("threshold boundary is inclusive", () => {
  assert.equal(
    statusFromVerification({
      result: "verified_clean",
      confidence: VERIFY_CONFIDENCE_THRESHOLD,
      reasoning: "",
    }),
    "awaiting_confirmation",
  );
});

console.log("stub provider:");

await checkAsync("stub is marked not-live so the UI can disclose it", async () => {
  assert.equal(stubProvider.isLive, false);
});

await checkAsync("stub classify is deterministic and in-range", async () => {
  const img = { data: "AAAABBBBCCCC", mimeType: "image/jpeg" };
  const a = await stubProvider.classify(img);
  const b = await stubProvider.classify(img);
  assert.deepEqual(a, b);
  assert.ok(a.severity >= 1 && a.severity <= 5);
});

await checkAsync("stub verify rejects an identical resubmitted photo", async () => {
  const img = { data: "SAME", mimeType: "image/jpeg" };
  const v = await stubProvider.verify(img, img, { waste_type: "mixed", severity: 3 });
  assert.equal(v.result, "not_clean");
  // and that must not produce a green pin
  assert.equal(statusFromVerification(v), "claimed");
});

await checkAsync("stub verify never fabricates a green pin", async () => {
  const v = await stubProvider.verify(
    { data: "BEFORE", mimeType: "image/jpeg" },
    { data: "AFTER", mimeType: "image/jpeg" },
    { waste_type: "mixed", severity: 3 },
  );
  assert.equal(statusFromVerification(v), "claimed");
});

console.log("sql splitter:");
check("splitSql: splits on top-level semicolons, drops empties and comments-only", () => {
  assert.deepEqual(splitSql("create table a (x int);\n-- note; not a split\nalter table a add y int;\n"), [
    "create table a (x int)",
    "-- note; not a split\nalter table a add y int",
  ]);
});
check("splitSql: keeps $$ bodies and quoted semicolons intact", () => {
  const sql = "do $$ begin perform 1; perform 2; end $$;\ninsert into t values ('a;b');";
  assert.deepEqual(splitSql(sql), ["do $$ begin perform 1; perform 2; end $$", "insert into t values ('a;b')"]);
});

console.log("lifecycle:");
check("timeline-only events never change status", () => {
  for (const k of ["received", "sent", "acknowledged", "assigned", "eta_set", "escalated"] as const)
    assert.equal(nextStatus("open", k), "open");
  assert.equal(nextStatus("claimed", "acknowledged"), "claimed");
});
check("verified goes to awaiting_confirmation, never straight to resolved", () => {
  assert.equal(nextStatus("open", "verified"), "awaiting_confirmation");
  assert.equal(nextStatus("claimed", "verified"), "awaiting_confirmation");
});
check("confirm / auto-close resolve; dispute reopens", () => {
  assert.equal(nextStatus("awaiting_confirmation", "confirmed"), "verified_resolved");
  assert.equal(nextStatus("awaiting_confirmation", "auto_closed"), "verified_resolved");
  assert.equal(nextStatus("awaiting_confirmation", "disputed"), "open");
  assert.equal(nextStatus("verified_resolved", "reopened"), "open");
});
check("impossible transitions are rejected (null)", () => {
  assert.equal(nextStatus("open", "confirmed"), null);
  assert.equal(nextStatus("verified_resolved", "verified"), null);
  assert.equal(nextStatus("verified_resolved", "acknowledged"), null);
  assert.equal(nextStatus("open", "reopened"), null);
});

console.log("GBA wards:");
check("wardAt: Vidhana Soudha is in a Central corporation ward", () => {
  const w = wardAt(12.97966, 77.59072);
  assert.ok(w, "expected a ward");
  assert.equal(w.corporation, "Central");
  assert.ok(w.zone_name && w.name);
});
check("wardAt: points outside Bengaluru return null", () => {
  assert.equal(wardAt(12.5, 77.0), null);
  assert.equal(wardAt(0, 0), null);
});
check("wardMeta round-trips an id and rejects unknown ids", () => {
  const w = wardAt(12.97966, 77.59072)!;
  assert.equal(wardMeta(w.id)?.name, w.name);
  assert.equal(wardMeta("nowhere-999"), null);
});

console.log("officials:");
const ward = { id: "south-28", zone_name: "Bommanahalli", corporation: "South" };
const o = (p: Partial<Official>): Official => ({ level: "city", category: "all", role: "r", name: null, ward_id: null, zone: null, corporation: null, photo_url: null, email: null, source_url: null, verified_at: null, ...p });
const city = o({ level: "city", role: "Chief Commissioner", name: "C" });
const corp = o({ level: "corporation", corporation: "South", role: "Commissioner", name: "S" });
const zone = o({ level: "zone", zone: "Bommanahalli", role: "Zonal Commissioner", name: "Z" });
const wardRoad = o({ level: "ward", ward_id: "south-28", category: "road", role: "AEE", name: "W" });
check("pickOfficial: most specific level wins (ward > zone > corporation > city)", () => {
  assert.equal(pickOfficial([city, corp, zone, wardRoad], ward, "road")?.name, "W");
  assert.equal(pickOfficial([city, corp, zone], ward, "road")?.name, "Z");
  assert.equal(pickOfficial([city, corp], ward, "waste")?.name, "S");
  assert.equal(pickOfficial([city], ward, "waste")?.name, "C");
});
check("pickOfficial: category must match (or be 'all'); other wards/zones never match", () => {
  assert.equal(pickOfficial([wardRoad, city], ward, "waste")?.name, "C");
  const other = o({ level: "ward", ward_id: "south-29", category: "waste", name: "X" });
  const otherZone = o({ level: "zone", zone: "Jayanagar", name: "Y" });
  assert.equal(pickOfficial([other, otherZone, corp], ward, "waste")?.name, "S");
  assert.equal(pickOfficial([], ward, "waste"), null);
});
check("pickOfficial: an unnamed post is skipped in favour of a named one above it", () => {
  const unnamed = o({ level: "zone", zone: "Bommanahalli", name: null });
  assert.equal(pickOfficial([unnamed, corp], ward, "waste")?.name, "S");
});

console.log("action links:");
const SECRET = "test-secret";
check("action token: a fresh token verifies to its report and action", () => {
  const t = signAction("r1", "ack", SECRET, 1_000);
  assert.deepEqual(verifyAction(t, SECRET, 2_000), { reportId: "r1", action: "ack" });
});
check("action token: tampered, wrong-secret and expired tokens are rejected", () => {
  const t = signAction("r1", "ack", SECRET, 1_000);
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), a: "resolve" })).toString("base64url");
  assert.equal(verifyAction(`${forged}.${sig}`, SECRET, 2_000), null);
  assert.equal(verifyAction(t, "other-secret", 2_000), null);
  assert.equal(verifyAction(t, SECRET, 1_000 + 15 * 86_400_000), null);
  assert.equal(verifyAction("garbage", SECRET, 2_000), null);
});

console.log("reporter identity:");
check("isReporter: matching session or matching tracking code proves it", () => {
  const r = { reporter_session_id: "s1", tracking_code_hash: hashCode("abc123XYZ0") };
  assert.equal(isReporter(r, "s1", null), true);
  assert.equal(isReporter(r, null, "abc123XYZ0"), true);
});
check("isReporter: wrong/missing session and code are refused, and null never matches null", () => {
  const r = { reporter_session_id: "s1", tracking_code_hash: hashCode("abc123XYZ0") };
  assert.equal(isReporter(r, "s2", "wrong"), false);
  assert.equal(isReporter(r, null, null), false);
  assert.equal(isReporter({ reporter_session_id: null, tracking_code_hash: null }, null, null), false);
  assert.equal(isReporter({ reporter_session_id: null, tracking_code_hash: null }, "", ""), false);
});

console.log(`\n${passed} checks passed`);
