# CleanLoop

Report a garbage dump with a photo. AI verifies the cleanup **actually happened** before the case closes.

Built for the KE Startup Fest Hackathon — Social & Community Impact / Waste Management, Bengaluru, 22 Aug 2026.

---

## The one thing that matters

Civic garbage-reporting tools already prove people will report. What none of them do is
**verify the cleanup**. A "resolved" status is somebody's word.

CleanLoop checks the after photo with an image classifier and the phone's GPS, and only
flips a pin green when the waste is gone **and** the photo was taken at the spot. If the
model isn't confident — or the photo was taken somewhere else, or without a location — the
pin goes **yellow, "claimed, unverified"**, and the case stays open.

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
| 3D map, report flow, resolve flow, leaderboard, list view | ✅ built, `next build` passes |
| Non-waste rejected at intake | ✅ working — a photo that isn't street waste never becomes a report |
| Durable verification (watch + reopen on refill) | ✅ working end to end |
| English / ಕನ್ನಡ | ✅ shipped (Kannada strings are draft, not yet reviewed by a native speaker) |
| Seed data (120 synthetic reports, 574 real facilities) | ✅ loaded |
| **Live AI** | ✅ **wired and running in production** |

### The image model

A seven-class image classifier trained on [Teachable Machine](https://teachablemachine.withgoogle.com/):
`mixed`, `plastic`, `organic`, `construction`, `hazardous`, `not_garbage` (a clean outdoor
place) and `irrelevant` (screenshots, documents, rooms, food — not a photo of a place at all). It runs **on the
server** with `@tensorflow/tfjs` and `sharp` — never in the browser, because a client that
decides "clean" lets anyone POST a verified cleanup. No API key, no network call, no cost.

- **Intake:** a photo scored `not_garbage` or `irrelevant` is refused before anything is stored. Otherwise the
  model names the waste type; the reporter picks severity 1–5, which a classifier can't judge.
- **Verification:** green only when the after photo scores `not_garbage` ≥ 0.75 **and** the
  device's GPS fix is within 50 m of the report. No fix, too far, or a mid score → yellow.
  An `irrelevant` after photo or identical before/after bytes → `not_clean`.
- **Complaint text:** a fixed plain-text template (`src/lib/complaint.ts`).

The provider is chosen by `CLEANLOOP_AI_PROVIDER` (`tm`, or `stub` for offline development);
`src/lib/ai.ts` holds the `AiProvider` interface, so a swap touches one file.

**Measured on 131 held-out photos** the model never trained on: 119/131 correct on waste vs.
not-waste, 86/131 on the exact class, and 19/22 screenshots, documents and indoor shots caught
as `irrelevant`. 3 photos scored clean enough to pass the image check, which is why the GPS
check exists. Training images: 663 hand-reviewed photos and phone-size screenshots, listed
with source and licence in [`model/SOURCES.csv`](model/SOURCES.csv). Screenshots were
captured for training only and are not redistributed.

---
## Run it

```bash
npm install
npm run selfcheck   # 19 assertions, no network
npm run seed        # 120 synthetic reports + real OSM facilities (idempotent; --wipe to reset)
npm run dev
```

Requires `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `CLEANLOOP_AI_PROVIDER=tm` in the environment.

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
Next.js 16 (App Router, TS, Tailwind v4)  →  Vercel
Supabase Postgres + Storage               →  ap-south-1 Mumbai
MapLibre GL + OpenStreetMap tiles         →  no API key, 3D extruded severity
Teachable Machine classifier (tfjs)       →  runs server-side, no API key
```

- `src/lib/ai.ts` — provider interface + registry + stub. **The only file a provider swap touches.**
- `src/lib/providers/tm.ts` — loads `model/`, preprocesses like Teachable Machine, classifies
- `src/lib/supabase.ts` — clients, `findRecurring()` and `findVerifiedNearby()` geo queries
- `src/lib/durability.ts` — did a cleanup last? pure functions, no query, no model call
- `src/lib/wards.ts` — locality lookup, haversine, Bengaluru bounds check
- `src/lib/photo.ts` — browser-side downscaling before upload + defensive response parsing
- `src/app/api/reports/` — submit + list
- `src/app/api/reports/[id]/resolve/` — the verification endpoint
- `src/app/api/leaderboard/` — computed on read, never stored
- `src/app/api/stats/` — headline counts, integrity and durability

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
4. **Seed data is synthetic.** All 120 seeded reports are flagged `is_seed=true` and
   labelled in the UI. The photos are real Creative Commons waste images, but a seeded
   before/after pair is two *different* photographs — not one location cleaned. Every
   seeded resolution carries `is_genuine_pair=false` and the UI says so on the case. The
   574 mapped waste facilities are real OpenStreetMap nodes, not synthetic.
5. **The classifier is small and its data is thin in places.** Organic (96 photos) and
   hazardous (114) are under-represented and mostly not Bengaluru street scenes; mixed is
   often labelled plastic. A wrong type is cosmetic — the safety-relevant check is
   waste vs. not-waste, backed by the GPS rule. Browser GPS can be spoofed; photo EXIF or a
   moderator queue is the upgrade.

---

## What's next

- Photograph real dump spots and get genuinely verified before/after pairs — a handful of
  real cases beats any amount of synthetic data in the pitch
- Optimistic UI + retry so a slow or throttled call never blocks the funnel
- Get the Kannada strings reviewed by a native speaker before anyone relies on them
- Point-in-polygon against real BBMP ward GeoJSON, replacing the 12 locality centroids
