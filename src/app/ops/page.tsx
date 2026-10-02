/**
 * /ops — the pickup queue for ward collection crews and engineers. Public, no login.
 *
 * Importers/callers: linked from /performance. Server component; ?corp=<Corporation>&zone=<zone>
 * narrows the list. Open waste cases, most urgent first: past deadline, then severity, then age.
 * "Mark pickup" opens the existing cleanup flow (after photo + GPS + scene match), so a crew's
 * pickup is verified exactly like anyone else's — operators get no shortcut to green.
 * Excludes seeded demo cases, imports and [test] rows only from the overdue count, not the list,
 * so crews still see every pin on the map; demo cases are labelled.
 */
import Link from "next/link";
import { connection } from "next/server";
import { serverClient } from "@/lib/supabase";
import { slaState } from "@/lib/sla";

const CORPS = ["Central", "East", "North", "South", "West"];

/** Per-request clock (the page is dynamic via connection()). */
const requestTime = () => Date.now();

export default async function OpsPage({ searchParams }: { searchParams: Promise<{ corp?: string; zone?: string }> }) {
  await connection();
  const { corp, zone } = await searchParams;
  const db = serverClient();
  let q = db
    .from("reports")
    .select("id, created_at, acknowledged_at, verified_at, closed_at, status, category, waste_type, road_issue, severity, corporation, zone, gba_ward_id, photo_before_url, is_seed, is_recurring, reopen_count, assigned_to, eta_at, description")
    .in("status", ["open", "claimed"])
    .or("source.eq.cleanloop,is_public.eq.true")
    .limit(300);
  if (corp && CORPS.includes(corp)) q = q.eq("corporation", corp);
  if (zone) q = q.eq("zone", zone);
  const [{ data: rows }, { data: cfgRows }, { data: zoneRows }] = await Promise.all([
    q,
    db.from("sla_config").select("*"),
    db.from("reports").select("corporation, zone").not("zone", "is", null).limit(2000),
  ]);
  const cfg = Object.fromEntries((cfgRows ?? []).map((c) => [c.category, c]));
  const now = requestTime();
  const cases = (rows ?? [])
    .map((r) => ({ ...r, sla: slaState(r, cfg[r.category ?? "waste"] ?? cfg.waste, now) }))
    .sort(
      (a, b) =>
        Number(b.sla.resolveOverdue) - Number(a.sla.resolveOverdue) ||
        b.severity - a.severity ||
        Date.parse(a.created_at) - Date.parse(b.created_at),
    );
  const zones = [...new Set((zoneRows ?? []).filter((z) => !corp || z.corporation === corp).map((z) => z.zone as string))].sort();
  const chip = (href: string, label: string, on: boolean) => (
    <Link
      key={label}
      href={href}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${on ? "border-white bg-white text-black" : "border-white/15 text-white/70"}`}
    >
      {label}
    </Link>
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 text-white">
      <Link href="/" className="text-xs text-white/55">← CleanLoop map</Link>
      <h1 className="mt-3 text-2xl font-semibold">Pickup queue</h1>
      <p className="mt-1 text-sm text-white/60">
        Open cases, most urgent first. Clearing one needs an after photo taken at the spot, verified like any other.
      </p>

      <nav className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Corporation">
        {chip("/ops", "All", !corp)}
        {CORPS.map((c) => chip(`/ops?corp=${c}`, c, corp === c))}
      </nav>
      {corp && (
        <nav className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Zone">
          {chip(`/ops?corp=${corp}`, "All zones", !zone)}
          {zones.map((z) => chip(`/ops?corp=${corp}&zone=${encodeURIComponent(z)}`, z, zone === z))}
        </nav>
      )}

      <p className="mt-4 text-xs text-white/50">
        {cases.length} open · {cases.filter((c) => c.sla.resolveOverdue).length} past deadline
      </p>
      <ul className="mt-2 space-y-2">
        {cases.map((c) => (
          <li key={c.id} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.photo_before_url} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="font-medium capitalize">{c.category === "road" ? c.road_issue : c.waste_type}</span>
                <span className="text-white/50">· sev {c.severity}/5</span>
                {c.sla.resolveOverdue && <span className="rounded-full bg-[#ff6b5e]/20 px-2 py-0.5 text-[10px] text-[#ffb0a5]">Past deadline</span>}
                {(c.is_recurring || (c.reopen_count ?? 0) > 0) && (
                  <span className="rounded-full bg-[#ffb020]/20 px-2 py-0.5 text-[10px] text-[#ffd591]">Keeps refilling</span>
                )}
                {c.is_seed && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/55">Demo</span>}
              </div>
              <div className="mt-0.5 truncate text-xs text-white/55">
                {c.zone} · {c.corporation} · open {Math.floor((now - Date.parse(c.created_at)) / 86_400_000)}d
                {c.assigned_to && ` · ${c.assigned_to}`}
              </div>
              <div className="mt-2 flex gap-2">
                <Link href={`/?case=${c.id}`} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black">
                  Mark pickup
                </Link>
                <Link href={`/r/${c.id}`} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/75">
                  Details
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
