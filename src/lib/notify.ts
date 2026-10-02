/**
 * The email a responsible official receives when a case is reported in their area.
 *
 * Affected API: exports siteUrl(), notifyNewCase(). Called by POST /api/reports after insert.
 * One job (get the case acknowledged), one primary button, three secondary action links. All
 * action links are signed (src/lib/actionToken.ts) and open a confirm page; nothing acts on GET.
 * Recipient: the picked official's published email, else the GBA central address, with the
 * named official in the subject so it can be routed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { signAction, type Action } from "./actionToken.ts";
import { sendOnce } from "./mailer.ts";
import { OFFICIALS_FALLBACK_EMAIL, type Official } from "./officials.ts";
import type { GbaWard } from "./gbaWards.ts";

export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function notifyNewCase(
  db: SupabaseClient,
  r: { id: string; category: "waste" | "road"; kind: string; severity: number; lat: number; lng: number; photo_url: string },
  ward: GbaWard,
  official: Official | null,
): Promise<string> {
  const secret = process.env.ACTION_LINK_SECRET;
  if (!secret) throw new Error("ACTION_LINK_SECRET is not set");
  const base = siteUrl();
  const link = (a: Action) => `${base}/act?t=${signAction(r.id, a, secret)}`;
  const what = r.category === "road" ? `Road problem (${r.kind})` : `Garbage dump (${r.kind})`;
  const attn = official?.name ? `${official.name}, ${official.role}` : official?.role ?? "Ward office";
  const where = `Ward ${ward.ward_no} ${ward.name}, ${ward.zone_name} zone, ${ward.corporation} corporation`;
  const maps = `https://www.google.com/maps?q=${r.lat},${r.lng}`;
  const subject = `${what}, severity ${r.severity}/5 — ${ward.name} (Ward ${ward.ward_no}) — attn: ${attn}`;

  const text = [
    `A citizen reported this on CleanLoop. It is public and its response time is tracked per ward.`,
    ``,
    `${what}, severity ${r.severity}/5`,
    `${where}`,
    `Location: ${maps}`,
    `Photo: ${r.photo_url}`,
    `Case: ${base}/r/${r.id}`,
    ``,
    `Acknowledge: ${link("ack")}`,
    `Assign to someone: ${link("assign")}`,
    `Set an expected fix date: ${link("eta")}`,
    `Mark it resolved (after photo needed): ${link("resolve")}`,
    ``,
    `These links work for 14 days and need no login. Every action appears on the case's public timeline.`,
    `— CleanLoop, Bengaluru civic reports`,
  ].join("\n");

  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${label}</a>`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>A citizen reported this on CleanLoop. It is public and its response time is tracked per ward.</p>
<p><b>${esc(what)}, severity ${r.severity}/5</b><br>${esc(where)}<br><a href="${maps}">Open location</a> · <a href="${base}/r/${r.id}">Open case</a></p>
<p><img src="${r.photo_url}" alt="Reported photo" width="320" style="border-radius:8px;max-width:100%"></p>
<p>${btn(link("ack"), "Acknowledge")}</p>
<p><a href="${link("assign")}">Assign to someone</a> · <a href="${link("eta")}">Set expected fix date</a> · <a href="${link("resolve")}">Mark resolved</a></p>
<p style="color:#666;font-size:13px">Links work for 14 days and need no login. Every action appears on the case's public timeline.</p>
</div>`;

  return sendOnce(db, {
    to: official?.email ?? OFFICIALS_FALLBACK_EMAIL,
    subject,
    text,
    html,
    dedupeKey: `new:${r.id}`,
  });
}
