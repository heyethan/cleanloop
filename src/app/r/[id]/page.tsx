/**
 * /r/[id] — the public page for one case: photo, place, who is responsible, and its timeline.
 *
 * Importers/callers: linked from official emails (src/lib/notify.ts), /act, and the reporter's
 * private link (?code=). Server component; reads reports, report_events, officials.
 * ?resolve=1 (official "mark resolved") hands over to the map's cleanup flow for the after photo.
 * ?acted=<action> confirms an official's action landed.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { serverClient, PUBLIC_REPORT_COLUMNS } from "@/lib/supabase";
import { wardMeta } from "@/lib/gbaWards";
import { pickOfficial, type Official } from "@/lib/officials";
import ConfirmBox from "@/components/ConfirmBox";
import type { Report, ReportEvent } from "@/lib/types";

const STATUS: Record<string, { label: string; colour: string }> = {
  open: { label: "Open", colour: "#ff3b30" },
  claimed: { label: "Held for review", colour: "#ffb020" },
  awaiting_confirmation: { label: "Cleaned, awaiting confirmation", colour: "#8fe3bf" },
  verified_resolved: { label: "Verified clean", colour: "#22c98a" },
};

function eventText(e: ReportEvent): string {
  const d = e.data as Record<string, string | number | null | undefined>;
  switch (e.kind) {
    case "received": return "Reported by a citizen";
    case "sent": return `Sent to ${d.to ?? "the responsible official"}`;
    case "acknowledged": return "Acknowledged by the official";
    case "assigned": return `Assigned to ${d.assignee}`;
    case "eta_set": return `Expected fix date set: ${d.eta}`;
    case "escalated": return "Overdue — escalated";
    case "claimed": return `Cleanup photo held for review${d.reasoning ? `: ${d.reasoning}` : ""}`;
    case "verified": return "Cleanup photo verified clean";
    case "confirmed": return "Reporter confirmed it's clean — closed";
    case "auto_closed": return "Closed automatically: the reporter didn't respond in time";
    case "disputed": return `Reporter disputed the cleanup${d.note ? `: "${d.note}"` : ""} — reopened`;
    case "reopened": return `Reopened${d.reason ? `: ${d.reason}` : ""}`;
    default: return e.kind;
  }
}

/** Whole days left until `iso` (0 once passed), or null. Server-side, per request. */
function daysUntil(iso: string | null | undefined): number | null {
  return iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string; resolve?: string; acted?: string; note?: string }>;
}) {
  // Rendered per request: the timeline changes as officials act.
  await connection();
  const [{ id }, q] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = serverClient();
  const [{ data: report }, { data: events }, { data: officials }] = await Promise.all([
    db.from("reports").select(PUBLIC_REPORT_COLUMNS).eq("id", id).single(),
    db.from("report_events").select("*").eq("report_id", id).order("created_at"),
    db.from("officials").select("*").order("id"),
  ]);
  if (!report) notFound();
  const r = report as unknown as Report;
  const ward = r.gba_ward_id ? wardMeta(r.gba_ward_id) : null;
  const official = ward ? pickOfficial((officials ?? []) as Official[], ward, r.category ?? "waste") : null;
  const s = STATUS[r.status] ?? STATUS.open;
  const what = r.category === "road" ? r.road_issue : r.waste_type;

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6 text-white">
      <Link href="/" className="text-xs text-white/55">← CleanLoop map</Link>

      {q.acted && (
        <p className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75">
          {q.note === "already-closed" ? "This case was already closed, so nothing changed." : "Thanks — your action is on the timeline below."}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.colour }} />
        <span className="text-xs font-medium" style={{ color: s.colour }}>{s.label}</span>
      </div>
      <h1 className="mt-1 text-2xl font-semibold capitalize">{what} · severity {r.severity}/5</h1>
      {ward && (
        <p className="mt-1 text-sm text-white/65">
          Ward {ward.ward_no} {ward.name} · {ward.zone_name} zone · {ward.corporation} corporation
        </p>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={r.photo_before_url} alt="Reported photo" className="mt-4 h-56 w-full rounded-2xl object-cover" />
      {r.description && <p className="mt-3 text-sm text-white/75">&ldquo;{r.description}&rdquo;</p>}
      {r.source_attribution && (
        <p className="mt-2 text-xs text-white/50">
          Source: {r.source_url ? <a className="underline" href={r.source_url}>{r.source_attribution}</a> : r.source_attribution}
        </p>
      )}

      {q.resolve && r.status !== "verified_resolved" && (
        <Link href={`/?case=${r.id}`} className="mt-4 block rounded-full bg-white py-3 text-center text-sm font-semibold text-black">
          Upload the after photo
        </Link>
      )}

      {r.status === "awaiting_confirmation" && (
        <div className="mt-5">
          <ConfirmBox
            id={r.id}
            codeFromUrl={q.code ?? null}
            daysLeft={daysUntil(r.confirm_due_at)}
          />
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/50">Responsible</h2>
        {official ? (
          <div className="mt-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            {official.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={official.photo_url} alt={official.name ?? official.role} className="h-14 w-14 rounded-full object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-lg">{official.name?.[0] ?? "?"}</div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{official.name}</div>
              <div className="text-xs text-white/65">{official.role}</div>
              <div className="mt-0.5 text-[11px] text-white/40">
                {official.level === "ward" ? "Ward" : official.level === "zone" ? "Zone" : official.level === "corporation" ? "Corporation" : "City"} level
                {official.verified_at && ` · verified ${new Date(official.verified_at).toLocaleDateString("en-IN")}`}
                {official.source_url && (
                  <> · <a href={official.source_url} className="underline">source</a></>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-white/60">GBA helpline 1533 · comm@bbmp.gov.in</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/50">Timeline</h2>
        <ol className="mt-3 space-y-3 border-l border-white/10 pl-4">
          {((events ?? []) as ReportEvent[]).map((e) => (
            <li key={e.id}>
              <div className="text-sm text-white/85">{eventText(e)}</div>
              <div className="text-[11px] text-white/45">{fmt(e.created_at)}</div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
