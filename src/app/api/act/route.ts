/**
 * POST /api/act — an official acts on a case through a signed link (no account).
 *
 * Importers/callers: the form on /act (src/app/act/page.tsx), which official emails link to.
 * Accepts form fields: t (signed token, src/lib/actionToken.ts), assignee (assign), eta (date, eta).
 * GET never acts — mail scanners prefetch links — so the email opens /act, and only this POST
 * changes anything. "resolve" needs an after photo, so it hands over to the case page instead.
 */
import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { transition, TransitionError } from "@/lib/events";
import { verifyAction } from "@/lib/actionToken";

export async function POST(req: Request) {
  const form = await req.formData();
  const secret = process.env.ACTION_LINK_SECRET;
  const tok = secret ? verifyAction(String(form.get("t") ?? ""), secret) : null;
  if (!tok) return NextResponse.json({ error: "this link is invalid or has expired" }, { status: 403 });

  const caseUrl = new URL(`/r/${tok.reportId}`, req.url);
  if (tok.action === "resolve") {
    caseUrl.searchParams.set("resolve", "1");
    return NextResponse.redirect(caseUrl, 303);
  }

  const db = serverClient();
  try {
    if (tok.action === "ack") {
      await transition(db, tok.reportId, "acknowledged", "official");
    } else if (tok.action === "assign") {
      const assignee = String(form.get("assignee") ?? "").trim().slice(0, 120);
      if (!assignee) return NextResponse.json({ error: "say who it is assigned to" }, { status: 400 });
      await transition(db, tok.reportId, "assigned", "official", { data: { assignee }, patch: { assigned_to: assignee } });
    } else {
      const eta = new Date(String(form.get("eta") ?? ""));
      if (Number.isNaN(eta.getTime()) || eta.getTime() < Date.now() - 86_400_000) {
        return NextResponse.json({ error: "pick a date from today onwards" }, { status: 400 });
      }
      await transition(db, tok.reportId, "eta_set", "official", {
        data: { eta: eta.toISOString().slice(0, 10) },
        patch: { eta_at: eta.toISOString() },
      });
    }
  } catch (e) {
    if (!(e instanceof TransitionError)) throw e;
    caseUrl.searchParams.set("note", "already-closed");
  }
  caseUrl.searchParams.set("acted", tok.action);
  return NextResponse.redirect(caseUrl, 303);
}
