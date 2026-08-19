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
import { haversineMetres, nearestWard, wardName, WARDS } from "../src/lib/wards.ts";
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

check("high-confidence clean flips to verified_resolved (green)", () => {
  assert.equal(
    statusFromVerification({ result: "verified_clean", confidence: 0.95, reasoning: "" }),
    "verified_resolved",
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
    "verified_resolved",
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

console.log(`\n${passed} checks passed`);
