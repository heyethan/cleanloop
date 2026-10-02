/**
 * GET /api/cron/daily — runs once a day from Vercel Cron (vercel.json, 03:30 UTC = 09:00 IST).
 *
 * Importers/callers: Vercel Cron only. Requires `Authorization: Bearer ${CRON_SECRET}`.
 * 1. Auto-closes verified cleanups whose reporter didn't answer by confirm_due_at (labelled on the
 *    timeline as auto-closed, counted separately on /performance).
 * 2. Emails one overdue digest per corporation per day (deduped in email_log, capped by
 *    MAIL_DAILY_CAP), and marks each case's first escalation on its timeline.
 * Only real citizen reports count: seeded demo rows, imports and "[test]" rows are excluded, so
 * no official is ever emailed about synthetic data.
 */
import { NextResponse } from "next/server";
import { serverClient, selectAll } from "@/lib/supabase";
import { transition } from "@/lib/events";
import { slaState } from "@/lib/sla";
import { sendOnce } from "@/lib/mailer";
import { siteUrl } from "@/lib/notify";
import { OFFICIALS_FALLBACK_EMAIL, type Official } from "@/lib/officials";

const DAILY_CAP = Number(process.env.MAIL_DAILY_CAP ?? 20);

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = serverClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // 1. auto-close
  const { data: due } = await db
    .from("reports")
    .select("id")
    .eq("status", "awaiting_confirmation")
    .lt("confirm_due_at", now.toISOString());
  let autoClosed = 0;
  for (const r of due ?? []) {
    await transition(db, r.id, "auto_closed", "system").then(() => autoClosed++, () => {});
  }

  // 2. overdue digests
  const [{ data: rows }, { data: cfgRows }, { data: officials }, { data: escalated }, { count: sentToday }] =
    await Promise.all([
      db
        .from("reports")
        .select("id, created_at, acknowledged_at, verified_at, closed_at, status, category, corporation, zone, gba_ward_id, waste_type, road_issue, severity, description")
        .in("status", ["open", "claimed"])
        .eq("is_seed", false)
        .eq("source", "cleanloop"),
      db.from("sla_config").select("*"),
      db.from("officials").select("*").order("id"),
      selectAll<{ report_id: string }>((from, to) => db.from("report_events").select("report_id").eq("kind", "escalated").order("id").range(from, to)).then((data) => ({ data })),
      db.from("email_log").select("id", { count: "exact", head: true }).gte("sent_at", `${today}T00:00:00Z`),
    ]);
  const cfg = Object.fromEntries((cfgRows ?? []).map((c) => [c.category, c]));
  const already = new Set((escalated ?? []).map((e) => e.report_id));
  const overdue = (rows ?? []).filter(
    (r) => !r.description?.startsWith("[test]") && r.corporation && cfg[r.category ?? "waste"] &&
      slaState(r, cfg[r.category ?? "waste"], now.getTime()).resolveOverdue,
  );

  const byCorp = new Map<string, typeof overdue>();
  for (const r of overdue) byCorp.set(r.corporation!, [...(byCorp.get(r.corporation!) ?? []), r]);

  let mailed = 0;
  let budget = Math.max(0, DAILY_CAP - (sentToday ?? 0));
  for (const [corp, cases] of byCorp) {
    if (budget <= 0) break;
    const head = ((officials ?? []) as Official[]).find((o) => o.level === "corporation" && o.corporation === corp && o.category === "all" && o.name);
    const lines = cases
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((r) => `- ${r.category === "road" ? r.road_issue : r.waste_type}, severity ${r.severity}/5, ${r.zone}, open ${Math.floor((now.getTime() - Date.parse(r.created_at)) / 86_400_000)} days: ${siteUrl()}/r/${r.id}`);
    const outcome = await sendOnce(db, {
      to: head?.email ?? OFFICIALS_FALLBACK_EMAIL,
      subject: `${cases.length} overdue civic complaint${cases.length === 1 ? "" : "s"} — ${corp} corporation — attn: ${head?.name ?? "Commissioner"}`,
      text: [
        `These citizen reports in ${corp} corporation are past their resolution deadline on CleanLoop, oldest first.`,
        `Each link has the photo, location and the actions to acknowledge, assign or set a fix date.`,
        ``,
        ...lines,
        ``,
        `Public performance by corporation, zone and ward: ${siteUrl()}/performance`,
        `— CleanLoop, Bengaluru civic reports`,
      ].join("\n"),
      html: `<p>These citizen reports in ${corp} corporation are past their resolution deadline on CleanLoop, oldest first.</p><ul>${lines.map((l) => `<li>${l.slice(2)}</li>`).join("")}</ul><p><a href="${siteUrl()}/performance">Public performance by corporation, zone and ward</a></p>`,
      dedupeKey: `digest:${corp}:${today}`,
    });
    if (outcome !== "sent") continue; // paused (printed) or already sent today: no escalation events
    mailed++;
    budget--;
    for (const r of cases.filter((c) => !already.has(c.id))) {
      await transition(db, r.id, "escalated", "system", { data: { to: head?.name ?? "corporation", via: "daily digest" } }).catch(() => {});
    }
  }

  return NextResponse.json({ autoClosed, overdue: overdue.length, corporations: byCorp.size, digestsSent: mailed });
}
