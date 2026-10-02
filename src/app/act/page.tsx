/**
 * /act?t=<token> — what an official sees after clicking a link in the CleanLoop email.
 *
 * Importers/callers: links built in src/lib/notify.ts. Rendering this page changes nothing; the
 * form POSTs to /api/act, which is the only place the action happens (scanner-safe).
 */
import Link from "next/link";
import { verifyAction } from "@/lib/actionToken";
import { serverClient } from "@/lib/supabase";

const TITLES = {
  ack: "Acknowledge this complaint",
  assign: "Assign this complaint",
  eta: "Set an expected fix date",
  resolve: "Mark this resolved",
} as const;

export default async function ActPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const secret = process.env.ACTION_LINK_SECRET;
  const tok = secret ? verifyAction(t, secret) : null;

  if (!tok) {
    return (
      <main className="mx-auto max-w-md px-5 py-16 text-white">
        <h1 className="text-xl font-semibold">This link has expired or is invalid</h1>
        <p className="mt-2 text-sm text-white/60">Action links work for 14 days. The case itself is still public.</p>
      </main>
    );
  }

  const { data: r } = await serverClient()
    .from("reports")
    .select("id, photo_before_url, waste_type, road_issue, category, severity, corporation, zone, status")
    .eq("id", tok.reportId)
    .single();

  return (
    <main className="mx-auto max-w-md px-5 py-12 text-white">
      <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">CleanLoop · official action</p>
      <h1 className="mt-1 text-2xl font-semibold">{TITLES[tok.action]}</h1>
      {r && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.photo_before_url} alt="Reported photo" className="h-48 w-full object-cover" />
          <div className="px-4 py-3 text-sm text-white/75">
            <span className="capitalize">{r.category === "road" ? r.road_issue : r.waste_type}</span> · severity{" "}
            {r.severity}/5 · {r.zone}, {r.corporation}
          </div>
        </div>
      )}
      <form action="/api/act" method="post" className="mt-6 space-y-3">
        <input type="hidden" name="t" value={t} />
        {tok.action === "assign" && (
          <input
            name="assignee"
            required
            maxLength={120}
            placeholder="Name and role, e.g. Ravi K, Health Inspector"
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-white/40"
          />
        )}
        {tok.action === "eta" && (
          <input
            type="date"
            name="eta"
            required
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-white/40 [color-scheme:dark]"
          />
        )}
        <button className="w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black">
          {tok.action === "resolve" ? "Continue to upload the after photo" : TITLES[tok.action]}
        </button>
      </form>
      <p className="mt-4 text-xs text-white/50">
        This is recorded on the case&apos;s public timeline. <Link href={`/r/${tok.reportId}`} className="underline">View the case</Link>
      </p>
    </main>
  );
}
