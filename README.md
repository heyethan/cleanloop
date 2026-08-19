# CleanLoop

Report a garbage dump with a photo. AI verifies the cleanup **actually happened** before the case closes.

Built for the KE Startup Fest Hackathon — Social & Community Impact / Waste Management, Bengaluru, 22 Aug 2026.

---

## The one thing that matters

Civic garbage-reporting tools already prove people will report. What none of them do is
**verify the cleanup**. A "resolved" status is somebody's word.

CleanLoop compares the before and after photos with a vision model and only flips a pin
green when the waste is actually gone. If the model isn't confident — or the two photos
don't look like the same place — the pin goes **yellow, "claimed, unverified"**, and the
case stays open.

A false green would destroy the product's only reason to exist, so the system is built to
prefer a false yellow.

---

## Current status — read this first

| Piece | State |
|---|---|
| Supabase schema, RLS, storage | ✅ live (project `easrgnsidtazgphcybsi`, ap-south-1 Mumbai) |
| Report → upload → classify → complaint → pin | ✅ working end to end |
| Recurring-spot detection (50m / 14 days) | ✅ working, verified at 20m |
| Before/after verification + green/yellow logic | ✅ working end to end |
| Map, report flow, resolve flow, leaderboard | ✅ built, `next build` passes |
| Seed data (46 synthetic reports) | ✅ loaded |
| **Live AI model** | ⏸️ **deliberately not wired — see below** |

### Why the AI is not wired

The **prompts are written and verified**. All three were run live against
`gemini-3.6-flash` on 2026-08-20 and produced correct structured output, including a
negative control: an identical before/after pair correctly returned `not_clean` at 0.98
confidence.

What's pending is only the **provider decision**, so the app currently runs on
`stubProvider` — deterministic, no network calls, clearly labelled in the UI wherever a
placeholder value is shown.

To wire a real provider:

1. Implement the `AiProvider` interface (three methods) in `src/lib/ai.ts`
2. Register it in the `providers` map
3. Set `CLEANLOOP_AI_PROVIDER=<name>` in `.env.local`

No route, component, or schema changes are required — routes depend only on the interface.

---

## Run it

```bash
npm install
npm run selfcheck   # 19 assertions, no network
npm run seed        # 46 synthetic reports (idempotent; --wipe to reset)
npm run dev
```

Requires `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

---

## AI prompt trail (rubric disclosure)

Three distinct AI calls. Full prompt text lives in [`src/lib/prompts.ts`](src/lib/prompts.ts)
and is reproduced verbatim there — nothing is paraphrased for this README.

### 1. Waste classification (`CLASSIFY_PROMPT`)
- **In:** before photo
- **Out:** `{waste_type, severity, confidence, one_line_description}` — enum-constrained,
  severity anchored 1–5 in the prompt
- **Verified:** returned valid enum + in-range severity on a live call

### 2. Complaint generation (`COMPLAINT_PROMPT`)
- **In:** waste_type, severity, is_recurring, ward name, lat/lng
- **Out:** 2–4 sentence neutral civic complaint, user-editable
- **Verified:** produced usable administrative-register text on a live call

### 3. Before/after verification (`VERIFY_PROMPT`) — the differentiator
- **In:** before photo + after photo + the original classification
- **Out:** `{result: verified_clean|ambiguous|not_clean, confidence, reasoning}`
- **Design note:** the prompt explicitly instructs the model to return `ambiguous` when
  the photos don't appear to show the same location. That's the most likely way this step
  gets gamed, so it's handled in the prompt rather than left to chance. It also states
  that lighting and angle differences alone are *not* evidence — the known false-negative
  failure mode.
- **Verified live, both directions:**
  - cleaned pair → `verified_clean`, confidence 0.95
  - **identical before/after → `not_clean`, confidence 0.98**

---

## How verification decides

```
verified_clean AND confidence >= 0.75  ->  green (verified_resolved), verified_at stamped
anything else                          ->  yellow (claimed), case stays open
```

Threshold lives in `VERIFY_CONFIDENCE_THRESHOLD` (`src/lib/ai.ts`). Five assertions in
`npm run selfcheck` pin this behaviour, including that `not_clean` and `ambiguous` can
never produce a green pin regardless of confidence.

**Tested end to end against the running app:** resubmitting the identical photo as the
"after" was rejected (`not_clean`, pin stayed `claimed`, self-resolution flagged).

---

## Architecture

```
Next.js 16 (App Router, TS, Tailwind)  →  Vercel
Supabase Postgres + Storage            →  ap-south-1 Mumbai
Leaflet + OpenStreetMap tiles          →  no API key
AiProvider interface                   →  provider-agnostic
```

- `src/lib/ai.ts` — provider interface + stub. **The only file a provider swap touches.**
- `src/lib/prompts.ts` — all three prompts, verbatim
- `src/lib/supabase.ts` — clients + `findRecurring()` geo query
- `src/lib/wards.ts` — locality lookup + haversine
- `src/app/api/reports/` — submit + list
- `src/app/api/reports/[id]/resolve/` — the verification endpoint
- `src/app/api/leaderboard/` — computed on read, never stored

**Recurring detection** is plain geo logic, not ML: a lat/lng bounding-box query against
the `(lat,lng)` index, then an exact haversine refine so the 50m radius is actually
circular. No PostGIS needed.

**Leaderboard** ranks by average days-to-*verified*-resolution. Raw complaint count is
shown but never ranked on — ranking by volume rewards noise, which is the failure this
product exists to fix.

---

## Known limitations — stated plainly

These are real and we'd rather name them than have a judge find them.

1. **Complaint submission to BBMP is not integrated.** The app generates complaint text;
   it does not file it. A real integration is a partnership conversation, not an 8-day
   build. Nothing in the UI claims otherwise.
2. **Wards are approximations.** No public Bengaluru ward-boundary API was confirmed, so
   reports are assigned to the nearest of 12 locality centroids (fetched from
   OpenStreetMap Nominatim, not written from memory). Not official BBMP wards. The UI
   says so. Upgrade path is point-in-polygon against real GeoJSON — one function changes.
3. **Anonymous reporting is abusable.** No login means fake reports and fake after-photos
   are possible. Session IDs are localStorage-based and trivially cleared. Mitigations in
   place: confidence thresholding, the yellow state, and self-resolution flagging.
   Real defences (device fingerprint rate-limiting, community flagging) are v2.
4. **Seed data is synthetic.** All 46 seeded reports are flagged `is_seed=true` and
   labelled in the UI. Placeholder images, not real Bengaluru dumps.
5. **Model latency is 3–30s and variable.** Measured on the free tier, which also
   rate-limits. Whichever provider is wired needs optimistic UI and backoff, or the demo
   risks a long spinner on stage.

---

## What's next

- Wire a provider (one file)
- Photograph real dump spots and get genuinely verified before/after pairs — a handful of
  real cases beats any amount of synthetic data in the pitch
- Optimistic UI + retry so a slow or throttled call never blocks the funnel
