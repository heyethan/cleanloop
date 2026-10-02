/**
 * POST /api/reports/[id]/confirm — the reporter confirms or disputes a verified cleanup.
 *
 * Importers/callers: called over HTTP by src/components/ConfirmBox.tsx (case page /r/[id]).
 * Accepts multipart/form-data: action (confirm|dispute), session_id and/or code (tracking code),
 * note (dispute reason, optional), photo (dispute evidence, optional).
 * Only the reporter may answer (src/lib/reporter.ts). confirm -> verified_resolved;
 * dispute -> open again (src/lib/lifecycle.ts), with the reason on the public timeline.
 */
import { NextResponse } from "next/server";
import { serverClient, uploadPhoto } from "@/lib/supabase";
import { transition, TransitionError } from "@/lib/events";
import { isReporter } from "@/lib/reporter";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const form = await req.formData();
    const action = form.get("action");
    if (action !== "confirm" && action !== "dispute") {
      return NextResponse.json({ error: "action must be confirm or dispute" }, { status: 400 });
    }

    const db = serverClient();
    const { data: report } = await db
      .from("reports")
      .select("id, status, reporter_session_id, tracking_code_hash")
      .eq("id", id)
      .single();
    if (!report) return NextResponse.json({ error: "report not found" }, { status: 404 });
    if (!isReporter(report, (form.get("session_id") as string) || null, (form.get("code") as string) || null)) {
      return NextResponse.json({ error: "only the person who reported this can confirm it" }, { status: 403 });
    }

    if (action === "confirm") {
      const status = await transition(db, id, "confirmed", "reporter");
      return NextResponse.json({ status });
    }

    const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
    const photo = form.get("photo");
    let photoUrl: string | null = null;
    if (photo instanceof File && photo.size > 0) {
      if (photo.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "photo too large" }, { status: 413 });
      photoUrl = await uploadPhoto(db, new Uint8Array(await photo.arrayBuffer()), photo.type, "after");
    }
    const status = await transition(db, id, "disputed", "reporter", { data: { note, photo_url: photoUrl } });
    return NextResponse.json({ status });
  } catch (e) {
    const code = e instanceof TransitionError ? 409 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status: code });
  }
}
