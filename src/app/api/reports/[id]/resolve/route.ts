/**
 * POST /api/reports/[id]/resolve — submit an "after" photo and verify (spec §3 Flow B).
 * This is the product's differentiator: nothing goes green on a human's say-so.
 *
 * Importers/callers: called over HTTP by src/components/ResolveSheet.tsx.
 * Not imported by other modules.
 * Affected API: this route's own HTTP contract.
 * Data schemas: inserts into `resolutions`, updates `reports.status`, writes the
 * `cleanloop` bucket. submitted_at / verified_at are timestamptz, ISO-8601
 * (e.g. "2026-08-20T14:03:11.482Z").
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * Accepts multipart/form-data: photo (File), session_id.
 */

import { NextResponse } from "next/server";
import { serverClient, uploadPhoto } from "@/lib/supabase";
import { getProvider, statusFromVerification } from "@/lib/ai";
import type { Report } from "@/lib/types";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const form = await req.formData();
    const photo = form.get("photo");
    const sessionId = (form.get("session_id") as string | null) ?? null;

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

    const db = serverClient();
    const ai = getProvider();

    const { data: reportRow, error: fetchErr } = await db
      .from("reports")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchErr || !reportRow) {
      return NextResponse.json({ error: "report not found" }, { status: 404 });
    }
    const report = reportRow as Report;

    if (report.status === "verified_resolved") {
      return NextResponse.json(
        { error: "report is already verified resolved" },
        { status: 409 },
      );
    }

    const afterBytes = new Uint8Array(await photo.arrayBuffer());
    const afterUrl = await uploadPhoto(db, afterBytes, photo.type, "after");

    // Re-fetch the stored before-photo so verification compares what was actually reported,
    // not something the client hands us.
    const beforeRes = await fetch(report.photo_before_url);
    if (!beforeRes.ok) {
      throw new Error(`could not read before photo (${beforeRes.status})`);
    }
    const beforeBytes = new Uint8Array(await beforeRes.arrayBuffer());
    const beforeMime = beforeRes.headers.get("content-type") ?? "image/jpeg";

    const verification = await ai.verify(
      { data: Buffer.from(beforeBytes).toString("base64"), mimeType: beforeMime },
      { data: Buffer.from(afterBytes).toString("base64"), mimeType: photo.type },
      { waste_type: report.waste_type, severity: report.severity },
    );

    const newStatus = statusFromVerification(verification);
    const verifiedAt = newStatus === "verified_resolved" ? new Date().toISOString() : null;

    // spec §3 Flow B / chosen option: anyone may resolve, but self-resolution is recorded.
    const isSelfResolved =
      sessionId !== null && sessionId === report.reporter_session_id;

    const { data: resolution, error: insErr } = await db
      .from("resolutions")
      .insert({
        report_id: report.id,
        photo_after_url: afterUrl,
        ai_verification_result: verification.result,
        ai_confidence: verification.confidence,
        ai_reasoning: verification.reasoning,
        verified_at: verifiedAt,
        resolver_session_id: sessionId,
        is_self_resolved: isSelfResolved,
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);

    const { error: updErr } = await db
      .from("reports")
      .update({ status: newStatus })
      .eq("id", report.id);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({
      resolution,
      verification,
      status: newStatus,
      is_self_resolved: isSelfResolved,
      ai_is_live: ai.isLive,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
