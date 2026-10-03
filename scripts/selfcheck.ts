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
import { readFileSync } from "node:fs";
import { haversineMetres } from "../src/lib/wards.ts";
import { countAreas, isOverdue, officialsSummary, type CaseRow } from "../src/lib/areas.ts";
import { wardAt, wardMeta } from "../src/lib/gbaWards.ts";
import { pickOfficial, type Official } from "../src/lib/officials.ts";
import { signAction, verifyAction } from "../src/lib/actionToken.ts";
import { isReporter, hashCode } from "../src/lib/reporter.ts";
import { slaState, median } from "../src/lib/sla.ts";
import { mapNammaKasa } from "./nammakasa-map.ts";
import { snapToRoad, roadQuality, ROADS } from "../src/lib/roads.ts";
import { roadIntake, roadVerdict } from "../src/lib/roadVerdict.ts";
import { wasteIntake, cleanScore } from "../src/lib/wasteVerdict.ts";
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
check("isReporter: only the private tracking code proves it", () => {
  const r = { reporter_session_id: "s1", tracking_code_hash: hashCode("abc123XYZ0") };
  assert.equal(isReporter(r, null, "abc123XYZ0"), true);
});
check("isReporter: a session id is NOT proof (it was publicly readable)", () => {
  const r = { reporter_session_id: "s1", tracking_code_hash: hashCode("abc123XYZ0") };
  assert.equal(isReporter(r, "s1", null), false);
});
check("isReporter: wrong/missing session and code are refused, and null never matches null", () => {
  const r = { reporter_session_id: "s1", tracking_code_hash: hashCode("abc123XYZ0") };
  assert.equal(isReporter(r, "s2", "wrong"), false);
  assert.equal(isReporter(r, null, null), false);
  assert.equal(isReporter({ reporter_session_id: null, tracking_code_hash: null }, null, null), false);
  assert.equal(isReporter({ reporter_session_id: null, tracking_code_hash: null }, "", ""), false);
});

console.log("SLA:");
const cfg = { ack_hours: 24, resolve_hours: 72 };
const t0 = Date.parse("2026-10-01T00:00:00Z");
const at = (h: number) => t0 + h * 3_600_000;
const base = { created_at: new Date(t0).toISOString(), acknowledged_at: null, status: "open" as const, closed_at: null, verified_at: null };
check("slaState: fresh case is on time", () => {
  const s = slaState(base, cfg, at(10));
  assert.equal(s.ackOverdue, false);
  assert.equal(s.resolveOverdue, false);
});
check("slaState: unacknowledged past 24h is ack-overdue; past 72h unresolved is resolve-overdue", () => {
  assert.equal(slaState(base, cfg, at(25)).ackOverdue, true);
  assert.equal(slaState(base, cfg, at(73)).resolveOverdue, true);
});
check("slaState: acknowledged in time is never ack-overdue; verified/closed cases are never resolve-overdue", () => {
  const acked = { ...base, acknowledged_at: new Date(at(5)).toISOString() };
  assert.equal(slaState(acked, cfg, at(100)).ackOverdue, false);
  const cleaned = { ...base, status: "awaiting_confirmation" as const, verified_at: new Date(at(50)).toISOString() };
  assert.equal(slaState(cleaned, cfg, at(100)).resolveOverdue, false);
});
check("median: odd, even, empty", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

console.log("NammaKasa import:");
const nk = {
  id: "abc", latitude: 12.97966, longitude: 77.59072, address: "MG Road", severity: "massive",
  category: "biomedical", status: "unresolved", photo_url: "https://x/p.jpg", created_at: "2026-05-01T10:00:00Z",
  ward_number_369: 4, upvote_count: 3, resolved_by_name: "Some Person", reporter_name: "Someone",
  notes: "private", moderation_metadata: { score: 0.9 }, fingerprint: "fp", resolution_status: null, resolved_photo_url: null,
};
check("mapNammaKasa: maps category/severity/status, ward from coordinates, attribution on every row", () => {
  const m = mapNammaKasa(nk)!;
  assert.equal(m.waste_type, "hazardous");
  assert.equal(m.severity, 5);
  assert.equal(m.status, "open");
  assert.equal(m.source, "nammakasa");
  assert.equal(m.source_id, "abc");
  assert.ok(m.source_attribution?.includes("NammaKasa"));
  assert.equal(m.corporation, "Central");
  assert.equal(m.is_seed, false);
});
check("mapNammaKasa: never copies names, notes, moderation data or fingerprints", () => {
  const flat = JSON.stringify(mapNammaKasa(nk));
  for (const leak of ["Some Person", "Someone", "private", "fingerprint", "fp\"", "score"]) assert.ok(!flat.includes(leak), leak);
});
check("mapNammaKasa: resolved cases map to verified_resolved; out-of-city points are skipped", () => {
  assert.equal(mapNammaKasa({ ...nk, status: "resolved", resolution_status: "approved" })!.status, "verified_resolved");
  assert.equal(mapNammaKasa({ ...nk, latitude: 0, longitude: 0 }), null);
});

console.log("roads:");
check("snapToRoad: a point on a road's own vertex snaps to that road at ~0 m", () => {
  const f = ROADS[100];
  const [lng, lat] = f.geometry.coordinates[0];
  const hit = snapToRoad(lat, lng)!;
  assert.ok(hit && hit.metres < 1, `got ${hit?.metres}`);
});
check("snapToRoad: nothing within 30 m (open sea) returns null", () => {
  assert.equal(snapToRoad(0, 0), null);
});
check("roadQuality: no reports = unknown; fresh severe open report = poor; repaired recently = good", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const day = (d: number) => new Date(now - d * 86_400_000).toISOString();
  assert.equal(roadQuality([], now), "unknown");
  assert.equal(roadQuality([{ severity: 4, status: "open", created_at: day(2) }], now), "poor");
  assert.equal(roadQuality([{ severity: 4, status: "verified_resolved", created_at: day(20) }], now), "good");
});
check("roadQuality: an old minor report has decayed below 'poor'", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  assert.notEqual(roadQuality([{ severity: 1, status: "open", created_at: new Date(now - 120 * 86_400_000).toISOString() }], now), "poor");
});

console.log("road verdicts:");
check("roadIntake: a pothole or damaged road is accepted; a good road or a screenshot is refused", () => {
  assert.equal(roadIntake({ pothole: 0.8, damaged_road: 0.1, good_road: 0.1 }).ok, true);
  assert.equal(roadIntake({ pothole: 0.3, damaged_road: 0.4, good_road: 0.3 }).ok, true);
  assert.equal(roadIntake({ pothole: 0.1, damaged_road: 0.1, good_road: 0.8 }).ok, false);
  assert.equal(roadIntake({ irrelevant: 0.9, pothole: 0.05 }).ok, false);
});
check("roadVerdict: repaired road at the same place is verified; elsewhere/unclear is held; still broken is not_clean", () => {
  assert.equal(roadVerdict({ good_road: 0.9 }, 0.5).result, "verified_clean");
  assert.equal(roadVerdict({ good_road: 0.9 }, 0.1).result, "ambiguous");
  assert.equal(roadVerdict({ good_road: 0.5, pothole: 0.5 }, 0.5).result, "ambiguous");
  assert.equal(roadVerdict({ pothole: 0.9, good_road: 0.05 }, 0.5).result, "not_clean");
  assert.equal(roadVerdict({ irrelevant: 0.9 }, 0.9).result, "not_clean");
});

console.log("waste intake (10-class model):");
check("wasteIntake: waste classes summing past half are accepted as the top waste type", () => {
  const r = wasteIntake({ mixed: 0.35, plastic: 0.25, not_garbage: 0.2, pothole: 0.2 });
  assert.equal(r.ok, true);
  assert.equal(r.waste_type, "mixed");
});
check("wasteIntake: road damage photo is refused with a pointer to road reports", () => {
  const r = wasteIntake({ pothole: 0.6, damaged_road: 0.2, mixed: 0.2 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /road damage/i);
});
check("wasteIntake: screenshot and clean street are refused", () => {
  assert.equal(wasteIntake({ irrelevant: 0.9 }).ok, false);
  assert.equal(wasteIntake({ not_garbage: 0.5, good_road: 0.4, mixed: 0.1 }).ok, false);
});
check("cleanScore: a clean street split between not_garbage and good_road still counts as clean", () => {
  assert.ok(cleanScore({ not_garbage: 0.45, good_road: 0.4 }) >= 0.75);
});

console.log("areas (zones, wards, counts, officials island):");

const gbaWards = JSON.parse(readFileSync(new URL("../src/data/gba-wards.json", import.meta.url), "utf8")).features as {
  properties: { id: string; zone_name: string; corporation: string };
  geometry: { coordinates: number[][][][] };
}[];
const gbaZones = JSON.parse(readFileSync(new URL("../src/data/gba-zones.json", import.meta.url), "utf8")).zones as {
  zone_name: string; corporation: string; bbox: number[]; outline: number[][][];
}[];

check("10 zones, every ward inside its zone (same corporation, bbox contained)", () => {
  assert.equal(gbaZones.length, 10);
  const byName = new Map(gbaZones.map((z) => [z.zone_name, z]));
  assert.equal(gbaWards.length, 369);
  for (const w of gbaWards) {
    const z = byName.get(w.properties.zone_name);
    assert.ok(z, `${w.properties.id}: unknown zone ${w.properties.zone_name}`);
    assert.equal(z.corporation, w.properties.corporation);
    for (const poly of w.geometry.coordinates)
      for (const [x, y] of poly[0])
        assert.ok(x >= z.bbox[0] && x <= z.bbox[2] && y >= z.bbox[1] && y <= z.bbox[3], `${w.properties.id} leaves ${z.zone_name}`);
  }
});

check("zone outlines exist and stay inside their zone's box", () => {
  for (const z of gbaZones) {
    assert.ok(z.outline.length > 0, `${z.zone_name} has no outline`);
    for (const run of z.outline) for (const [x, y] of run) assert.ok(x >= z.bbox[0] && x <= z.bbox[2] && y >= z.bbox[1] && y <= z.bbox[3]);
  }
});

const SLA = { waste: { ack_hours: 24, resolve_hours: 72 }, road: { ack_hours: 72, resolve_hours: 720 } };
const NOW = Date.parse("2026-10-03T00:00:00Z");
const row = (p: Partial<CaseRow>): CaseRow => ({
  created_at: "2026-10-02T00:00:00Z", acknowledged_at: null, verified_at: null, closed_at: null, status: "open",
  category: "waste", source: "cleanloop", description: null, gba_ward_id: "south-28", zone: "Jayanagar", corporation: "South", ...p,
});
const sample: CaseRow[] = [
  row({}), // open, not yet due
  row({ created_at: "2026-09-20T00:00:00Z" }), // overdue
  row({ created_at: "2026-09-20T00:00:00Z", status: "claimed", zone: "Bommanahalli", gba_ward_id: "south-1" }), // overdue
  row({ created_at: "2026-09-20T00:00:00Z", category: "road" }), // road: 30 days, not due
  row({ created_at: "2026-09-20T00:00:00Z", status: "verified_resolved" }), // done: not counted
  row({ created_at: "2026-09-20T00:00:00Z", source: "nammakasa" }), // import: never counted
  row({ created_at: "2026-09-20T00:00:00Z", description: "[test] qa" }), // QA row: never counted
  row({ created_at: "2026-09-20T00:00:00Z", corporation: null }), // unmapped: not counted (as /performance)
];

check("countAreas: open/overdue per ward, zone, corporation and city; imports, tests, closed excluded", () => {
  const c = countAreas(sample, SLA, NOW);
  assert.deepEqual(c.get("city"), { open: 4, overdue: 2 });
  assert.deepEqual(c.get("corp:South"), { open: 4, overdue: 2 });
  assert.deepEqual(c.get("zone:Jayanagar"), { open: 3, overdue: 1 });
  assert.deepEqual(c.get("zone:Bommanahalli"), { open: 1, overdue: 1 });
  assert.deepEqual(c.get("ward:south-28"), { open: 3, overdue: 1 });
});

check("isOverdue agrees with the /performance rule (slaState.resolveOverdue on counted live cases)", () => {
  for (const r of sample) {
    const perf = r.source === "cleanloop" && !!r.corporation && !r.description?.startsWith("[test]") &&
      (r.status === "open" || r.status === "claimed") &&
      slaState(r, SLA[r.category ?? "waste"], NOW).resolveOverdue;
    assert.equal(isOverdue(r, SLA, NOW), perf);
  }
});

check("officialsSummary: one face per area, sorted by overdue, unnamed zones skipped", () => {
  const offs = [
    o({ level: "city", category: "all", name: "City Head", role: "Chief" }),
    o({ level: "corporation", corporation: "South", category: "all", name: "South Comm", role: "Commissioner" }),
    o({ level: "zone", zone: "Jayanagar", corporation: "South", category: "all", name: "Jaya ZC", role: "Zonal" }),
    o({ level: "zone", zone: "Jayanagar", corporation: "South", category: "all", name: "Jaya ZC 2", role: "Zonal" }),
    o({ level: "zone", zone: "Bommanahalli", corporation: "South", category: "all", name: null, role: "Zonal" }),
  ];
  const list = officialsSummary(offs, countAreas(sample, SLA, NOW), { South: ["Bommanahalli", "Jayanagar"] });
  assert.deepEqual(list.map((x) => x.name), ["City Head", "South Comm", "Jaya ZC"]);
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].overdue >= list[i].overdue);
  assert.deepEqual(list.find((x) => x.level === "corporation")?.zones, ["Bommanahalli", "Jayanagar"]);
});

console.log(`\n${passed} checks passed`);
