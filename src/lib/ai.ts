/**
 * CleanLoop AI layer — spec §6.
 *
 * Importers/callers: src/app/api/reports/route.ts (classify + complaint),
 * src/app/api/reports/[id]/resolve/route.ts (verify), scripts/seed.ts.
 * Affected API: exports AiProvider, getProvider(), stubProvider,
 * VERIFY_CONFIDENCE_THRESHOLD, statusFromVerification().
 * Data schemas: none written to disk; operates on in-memory base64 image strings
 * and returns Classification / Verification objects from ./types.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 * (with "Hold the AI wiring entirely" + "Thin swappable interface" selected).
 *
 * Thin swappable interface. Routes depend ONLY on `AiProvider`, never on a vendor SDK,
 * so changing provider is this one file and nothing else.
 *
 * Two implementations are registered:
 *   stub — deterministic, no network. The default, and what CI and seeding use.
 *   tm   — Teachable Machine image classifier run on the server (./providers/tm),
 *          model files in /model. No key, no network. CLEANLOOP_AI_PROVIDER=tm.
 *
 * `stubProvider` is NOT dead code and should not be deleted. It keeps the app fully
 * demoable with no key, no spend and no network, and it is what `isLive: false` drives:
 * the UI states plainly that a result is simulated rather than presenting a stub verdict
 * as a real one.
 *
 * The tm model was checked on 2026-10-01 against 131 held-out photos it never trained on:
 * 119 correct on waste vs. not-waste, 3 scored clean enough to pass the image check alone.
 * Those 3 are why the resolve route also requires a GPS fix within 50m of the report.
 *
 * TO ADD ANOTHER PROVIDER:
 *   1. implement AiProvider (three methods)
 *   2. register it in `providers` below
 *   3. set CLEANLOOP_AI_PROVIDER=<name> in .env.local
 * No route, component, or schema change is required.
 */

import type { Classification, ComplaintInput, Verification } from "./types";
// Explicit .ts extension: `npm run selfcheck` loads this file through Node's real ESM loader
// (`--experimental-strip-types`), which does not do the extensionless resolution the bundler
// does. Without it the whole self-check suite dies before its first assertion.
import { tmProvider } from "./providers/tm.ts";
import { complaintText } from "./complaint.ts";

export interface ImageInput {
  /** base64-encoded image bytes, no data: prefix */
  data: string;
  /** e.g. "image/jpeg" */
  mimeType: string;
}

export interface AiProvider {
  readonly name: string;
  /** True when this provider actually calls a model. False for the stub. */
  readonly isLive: boolean;
  /** §6.1 */
  classify(image: ImageInput): Promise<Classification>;
  /** §6.2 */
  complaint(input: ComplaintInput): Promise<string>;
  /** §6.3 — the differentiator */
  verify(
    before: ImageInput,
    after: ImageInput,
    original: Pick<Classification, "waste_type" | "severity">,
  ): Promise<Verification>;
}

/** FNV-1a over the base64 payload. Deterministic so the same photo always stubs the same. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const WASTE_TYPES = [
  "mixed",
  "plastic",
  "organic",
  "construction",
  "hazardous",
  "other",
] as const;

/**
 * Deterministic offline provider. Lets the full report → map → resolve → leaderboard loop
 * be built and demoed with zero API dependency.
 *
 * Its strings are deliberately clean, user-facing prose — no "[STUB]" markers leaking into
 * complaint text or descriptions that citizens and judges read. The fact that no model is
 * connected is surfaced ONCE by the UI via `isLive`, which is the honest place for it.
 *
 * Verify logic mirrors the real decision rule closely enough to exercise every UI branch:
 * identical before/after (someone re-submitting the same photo) is the gaming case, and it
 * returns not_clean — the same answer the live model gave on the negative control.
 */
export const stubProvider: AiProvider = {
  name: "stub",
  isLive: false,

  async classify(image) {
    const h = hash(image.data);
    return {
      // The stub cannot see the image, so it must not pretend to judge this. Always true,
      // which keeps offline development working; only a live model can actually reject.
      is_waste: true,
      waste_type: WASTE_TYPES[h % WASTE_TYPES.length],
      severity: (h % 5) + 1,
      confidence: 0.5,
      one_line_description: "Waste accumulation reported at this location.",
    };
  },

  async complaint(input) {
    return complaintText(input);
  },

  async verify(before, after) {
    // Identical bytes = the same photo resubmitted. Never treat that as a cleanup.
    if (before.data === after.data) {
      return {
        result: "not_clean",
        confidence: 0.98,
        reasoning: "The after photo is identical to the before photo.",
      };
    }
    return {
      result: "ambiguous",
      confidence: 0.4,
      reasoning: "Automated comparison is unavailable, so this cannot be confirmed clean.",
    };
  },
};

const providers: Record<string, AiProvider> = {
  stub: stubProvider,
  tm: tmProvider,
};

export function getProvider(): AiProvider {
  const name = process.env.CLEANLOOP_AI_PROVIDER ?? "stub";
  const p = providers[name];
  if (!p) {
    throw new Error(
      `Unknown CLEANLOOP_AI_PROVIDER "${name}". Registered: ${Object.keys(providers).join(", ")}. ` +
        `AI wiring is intentionally held — implement AiProvider and register it in src/lib/ai.ts.`,
    );
  }
  return p;
}

/**
 * Confidence at or above this flips a pin to green (spec §3 Flow B step 4).
 * Below it the pin goes yellow "claimed, unverified" and stays open for a human.
 * Deliberately high: a false green is far more damaging to the product's credibility
 * than a false yellow.
 */
export const VERIFY_CONFIDENCE_THRESHOLD = 0.75;

export function statusFromVerification(v: Verification): "claimed" | "verified_resolved" {
  return v.result === "verified_clean" && v.confidence >= VERIFY_CONFIDENCE_THRESHOLD
    ? "verified_resolved"
    : "claimed";
}
