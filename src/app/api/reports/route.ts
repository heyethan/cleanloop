/**
 * POST /api/reports — submit a report (spec §3 Flow A)
 * GET  /api/reports — list reports for the map (spec §3 Flow C)
 *
 * Importers/callers: called over HTTP by src/components/ReportSheet.tsx (POST) and
 * src/components/MapView.tsx (GET). Not imported by other modules.
 * Affected API: this route's own HTTP contract, documented below.
 * Data schemas: writes the `reports` table and the `cleanloop` storage bucket.
 * created_at is Postgres timestamptz serialised as ISO-8601 (e.g. "2026-08-20T14:03:11.482Z").
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * POST accepts multipart/form-data: photo (File), lat, lng, severity (1-5), session_id.
 * Returns the created report row.
 */

import { NextResponse } from "next/server";
import {
  findRecurring,
  findVerifiedNearby,
  serverClient,
  uploadPhoto,
  RECURRING_RADIUS_METRES,
  RECURRING_WINDOW_DAYS,
} from "@/lib/supabase";
import { getProvider } from "@/lib/ai";
import { isInBengaluru, nearestWard } from "@/lib/wards";
import { wardAt } from "@/lib/gbaWards";
import { pickOfficial, type Official } from "@/lib/officials";
import { notifyNewCase } from "@/lib/notify";
import { transition } from "@/lib/events";
import { randomBytes } from "node:crypto";
import { hashCode } from "@/lib/reporter";

/**
 * Photos come off a phone camera; cap to keep uploads and model calls sane.
 *
 * This was 10 MB, which was fiction: the platform rejects a body over ~4.5 MB with a
 * plaintext 413 before this function is invoked, so anything between 4.5 and 10 MB could
 * never reach the check below. Measured on production 2026-08-21 — 3 MB arrived here,
 * 5 MB did not. The client downscales before upload (src/lib/photo.ts); this is the
 * backstop for anything that bypasses it.
 */
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

export async function GET() {
  try {
    const db = serverClient();
    const { data, error } = await db
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return NextResponse.json({ reports: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const photo = form.get("photo");
    const latRaw = form.get("lat");
    const lngRaw = form.get("lng");
    const sessionId = (form.get("session_id") as string | null) ?? null;

    // --- validation at the trust boundary: this endpoint is public and unauthenticated ---
    if (!(photo instanceof File)) {
      return NextResponse.json({ error: "photo is required" }, { status: 400 });
    }
    if (photo.size === 0) {
      return NextResponse.json({ error: "photo is empty" }, { status: 400 });
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "photo too large (max 10MB)" }, { status: 413 });
    }
    if (!ALLOWED_MIME.includes(photo.type)) {
      return NextResponse.json(
        { error: `unsupported image type "${photo.type}"` },
        { status: 415 },
      );
    }
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return NextResponse.json({ error: "invalid lat" }, { status: 400 });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return NextResponse.json({ error: "invalid lng" }, { status: 400 });
    }
    /*
     * A coordinate can be valid on Earth and still be nonsense here. A half-filled manual
     * location form produced lat 1 / lng 0 — the Gulf of Guinea — and the globe-bounds
     * check above waved it through into the reports table. This app covers one city, so
     * that is the boundary worth enforcing.
     */
    if (!isInBengaluru(lat, lng)) {
      return NextResponse.json(
        { error: "That location is outside Bengaluru." },
        { status: 400 },
      );
    }

    // The image classifier can name the waste but cannot judge how bad it is; the reporter does.
    const severity = Number(form.get("severity"));
    if (!Number.isInteger(severity) || severity < 1 || severity > 5) {
      return NextResponse.json({ error: "severity must be 1 to 5" }, { status: 400 });
    }

    const db = serverClient();
    const ai = getProvider();

    const bytes = new Uint8Array(await photo.arrayBuffer());

    /*
     * Classify BEFORE uploading. The upload used to happen first, so a rejected photo would
     * still have left a file in the bucket; now nothing is stored unless the report is real.
     */
    const classification = await ai.classify({
      data: Buffer.from(bytes).toString("base64"),
      mimeType: photo.type,
    });

    /*
     * The front door. Without this the app accepted anything: a photo of a flowchart on a
     * monitor was filed as a Whitefield waste report, and the complaint writer — given only a
     * type and a severity — asserted "accumulated construction debris ... has been observed".
     *
     * The model was never wrong. It returned is-not-waste with 0.95 confidence and the
     * description "This image shows a flowchart diagram about a CSR ecosystem program, not
     * street waste." We stored that sentence and ignored it. A verification product whose
     * intake accepts any image is not verifying anything.
     *
     * The classifier's own sentence is returned so the citizen is told what we saw rather
     * than a generic refusal.
     */
    if (!classification.is_waste) {
      return NextResponse.json(
        {
          error: "That photo doesn't look like waste.",
          detail: classification.one_line_description,
        },
        { status: 422 },
      );
    }

    const photoUrl = await uploadPhoto(db, bytes, photo.type, "before");

    // Recurring detection is plain geo logic, not ML (spec §4).
    const prior = await findRecurring(db, lat, lng);
    const ward = nearestWard(lat, lng);
    // The real GBA ward drives accountability; `ward` (old locality) still labels the UI.
    const gba = wardAt(lat, lng);

    // Optional typed/dictated note (no audio is ever stored) and capture provenance.
    const description = String(form.get("description") ?? "").trim().slice(0, 500) || null;
    const accuracy = Number(form.get("location_accuracy_m"));
    // "[test]" reports are QA rows: stored like any other, never emailed to an official.
    const isTest = description?.startsWith("[test]") ?? false;

    // Anonymous follow-up: a code only the reporter sees. Only its hash is stored.
    const trackingCode = randomBytes(8).toString("base64url").slice(0, 10);

    const complaintText = await ai.complaint({
      waste_type: classification.waste_type,
      severity,
      description: classification.one_line_description,
      is_recurring: prior !== null,
      ward_name: ward?.name ?? null,
      lat,
      lng,
    });

    const { data, error } = await db
      .from("reports")
      .insert({
        photo_before_url: photoUrl,
        lat,
        lng,
        ward_id: ward?.id ?? null,
        waste_type: classification.waste_type,
        severity,
        is_recurring: prior !== null,
        recurring_of_report_id: prior?.id ?? null,
        status: "open",
        complaint_text: complaintText,
        ai_description: classification.one_line_description,
        ai_confidence: classification.confidence,
        reporter_session_id: sessionId,
        is_seed: false,
        gba_ward_id: gba?.id ?? null,
        corporation: gba?.corporation ?? null,
        zone: gba?.zone_name ?? null,
        description,
        location_accuracy_m: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null,
        capture_mode: form.get("capture_mode") === "camera" ? "camera" : "gallery",
        tracking_code_hash: hashCode(trackingCode),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    await transition(db, data.id, "received", "system");

    // Tell the responsible official. A mail failure must never lose the citizen's report.
    let official: Official | null = null;
    if (gba) {
      const { data: officials } = await db.from("officials").select("*");
      official = pickOfficial((officials ?? []) as Official[], gba, "waste");
      if (!isTest) {
        try {
          const outcome = await notifyNewCase(
            db,
            { id: data.id, category: "waste", kind: classification.waste_type, severity, lat, lng, photo_url: photoUrl },
            gba,
            official,
          );
          if (outcome !== "duplicate") {
            await transition(db, data.id, "sent", "system", {
              data: { to: official?.name ?? official?.role ?? "GBA central address", delivery: outcome },
            });
          }
        } catch (mailErr) {
          console.error("notify failed", data.id, (mailErr as Error).message);
        }
      }
    }

    /*
     * DURABLE VERIFICATION — the thing that separates this from a complaint form.
     *
     * If waste is reported within 50m of a spot we previously certified clean, that
     * certification did not hold. Reopen the old case rather than leaving a green pin over
     * a live dump: a resolution rate that counts cleanups which silently refilled is the
     * same self-congratulatory number every other civic app publishes.
     *
     * Done after the insert so a failure here cannot lose the citizen's report.
     */
    let refill: { reopened_report_id: string; ward_id: string | null } | null = null;
    const previouslyVerified = await findVerifiedNearby(db, lat, lng);
    if (previouslyVerified) {
      await transition(db, previouslyVerified.id, "reopened", "system", {
        data: { reason: "waste reported again within 50m", by_report: data.id },
      });
      refill = {
        reopened_report_id: previouslyVerified.id,
        ward_id: previouslyVerified.ward_id,
      };
    }

    return NextResponse.json({
      report: data,
      // Shown once to the reporter; we keep only its hash.
      tracking_code: trackingCode,
      ward: gba && { id: gba.id, name: gba.name, ward_no: gba.ward_no, zone: gba.zone_name, corporation: gba.corporation },
      official: official && { name: official.name, role: official.role, photo_url: official.photo_url, source_url: official.source_url },
      refill,
      ai_is_live: ai.isLive,
      recurring: prior
        ? {
            of_report_id: prior.id,
            within_metres: RECURRING_RADIUS_METRES,
            within_days: RECURRING_WINDOW_DAYS,
          }
        : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
