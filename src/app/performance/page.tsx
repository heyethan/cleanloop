/**
 * /performance — public accountability: how each corporation and zone responds, and who leads it.
 *
 * Importers/callers: linked from the overdue digest email and case pages. Server component over
 * src/lib/performance.ts (same numbers as GET /api/performance). Five metrics only: overdue,
 * median days to acknowledge, median days to verified clean, reopen rate, confirmation rate.
 * One magnitude per row (days to verified) drawn as a single-hue bar; every number is also text.
 */
import Link from "next/link";
import { connection } from "next/server";
import { serverClient } from "@/lib/supabase";
import { performance, type Perf } from "@/lib/performance";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const d1 = (x: number | null) => (x === null ? "—" : `${x.toFixed(1)}d`);

function Official({ o }: { o: Perf["official"] }) {
  if (!o) return <span className="text-white/40">Not published</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {o.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.photo_url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px]">{o.name?.[0]}</span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-white/90">{o.name}</span>
        <span className="block truncate text-[11px] text-white/45">{o.role}</span>
      </span>
    </span>
  );
}

function Row({ p, max, indent = false }: { p: Perf; max: number; indent?: boolean }) {
  const w = p.medianDaysToVerified === null ? 0 : Math.max(4, (p.medianDaysToVerified / max) * 100);
  return (
    // Phones: a stacked card per row (labels shown inline). md and up: the table grid.
    <div className={`grid grid-cols-2 items-center gap-x-3 gap-y-2 border-t border-white/[0.06] py-3 text-sm md:grid-cols-[1.3fr_1.6fr_0.7fr_1.4fr_0.7fr_0.8fr] md:gap-3 ${indent ? "pl-4 text-white/75" : ""}`}>
      <div className="col-span-2 font-medium md:col-span-1">{p.name}</div>
      <div className="col-span-2 min-w-0 md:col-span-1"><Official o={p.official} /></div>
      <div className={p.overdue ? "text-[#ff8a80]" : "text-white/60"} title={`${p.overdue} of ${p.open} open cases are past their deadline`}>
        <span className="text-[11px] text-white/45 md:hidden">Overdue </span>
        {p.overdue}<span className="text-white/35"> / {p.open}</span>
      </div>
      <div className="col-span-2 flex items-center gap-2 md:col-span-1" title={`Median ${d1(p.medianDaysToVerified)} from report to verified clean`}>
        <div className="h-2 flex-1 rounded-full bg-white/[0.06]">
          <div className="h-2 rounded-full bg-[#22c98a]" style={{ width: `${w}%` }} />
        </div>
        <span className="w-10 text-right tabular-nums text-white/80">{d1(p.medianDaysToVerified)}</span>
      </div>
      <div className="tabular-nums text-white/70"><span className="text-[11px] text-white/45 md:hidden">Reopened </span>{pct(p.reopenRate)}</div>
      <div className="tabular-nums text-white/70"><span className="text-[11px] text-white/45 md:hidden">Confirmed </span>{pct(p.confirmationRate)}</div>
    </div>
  );
}

export default async function PerformancePage() {
  await connection(); // always current
  const { city, corporations } = await performance(serverClient());
  const ranked = [...corporations].sort((a, b) => (a.medianDaysToVerified ?? 1e9) - (b.medianDaysToVerified ?? 1e9));
  const max = Math.max(...corporations.flatMap((c) => [c.medianDaysToVerified ?? 0, ...c.zones.map((z) => z.medianDaysToVerified ?? 0)]), 1);

  const tiles: [string, string, string][] = [
    ["Overdue now", `${city.overdue}`, `of ${city.open} open cases`],
    ["Median to acknowledge", d1(city.medianDaysToAck), "report → official responds"],
    ["Median to verified clean", d1(city.medianDaysToVerified), "report → after photo verified"],
    ["Reopened", pct(city.reopenRate), "cleanups that didn't hold"],
    ["Confirmed by reporter", pct(city.confirmationRate), "of closed cleanups"],
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-6 text-white">
      <Link href="/" className="text-xs text-white/55">← CleanLoop map</Link>
      <h1 className="mt-3 text-2xl font-semibold">Who is fixing Bengaluru&apos;s complaints</h1>
      <p className="mt-1 max-w-2xl text-sm text-white/60">
        Every case is mapped to its GBA ward, zone and corporation. A case is overdue when it isn&apos;t verified clean within
        its deadline (garbage: 3 days, roads: 30). Officials are named from government sources.
      </p>
      {city.demo > 0 && (
        <p className="mt-3 rounded-xl border border-[#ffb020]/30 bg-[#ffb020]/10 px-3 py-2 text-xs text-[#ffd591]">
          {city.demo} of {city.total} cases here are seeded demo data, not live citizen reports. Live numbers replace them as reports come in.
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[11px] uppercase tracking-[0.15em] text-white/45">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            <div className="text-[11px] text-white/45">{sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <div>
          <div className="hidden grid-cols-[1.3fr_1.6fr_0.7fr_1.4fr_0.7fr_0.8fr] gap-3 md:grid pb-2 text-[11px] uppercase tracking-[0.12em] text-white/45">
            <div>Corporation / zone</div>
            <div>Responsible</div>
            <div>Overdue</div>
            <div>Median to verified clean</div>
            <div>Reopened</div>
            <div>Confirmed</div>
          </div>
          {ranked.map((c) => (
            <details key={c.name} className="group">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <Row p={c} max={max} />
              </summary>
              {c.zones.map((z) => (
                <Row key={z.name} p={z} max={max} indent />
              ))}
            </details>
          ))}
        </div>
      </div>
      <p className="mt-4 text-[11px] text-white/40">
        Ranked by median days from report to verified clean, fastest first. Tap a corporation for its zones. Data:{" "}
        <a href="/api/performance" className="underline">/api/performance</a> (JSON). Ward boundaries: GBA via OpenCity.
      </p>
    </main>
  );
}
