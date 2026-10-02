/**
 * /lite — CleanLoop for slow connections and old phones: no map, no client JavaScript needed.
 *
 * Importers/callers: linked from the main page footer. Server component. Lists the 40 most recent
 * cases as text and offers a plain multipart form that posts to /api/reports, which redirects
 * back to the case page (or here with ?error=). Severity and location are typed or picked; the
 * camera opens directly on phones via capture="environment".
 */
import Link from "next/link";
import { connection } from "next/server";
import { serverClient } from "@/lib/supabase";

export const metadata = { title: "CleanLoop Lite" };

const STATUS: Record<string, string> = {
  open: "Open",
  claimed: "Held for review",
  awaiting_confirmation: "Cleaned, awaiting confirmation",
  verified_resolved: "Verified clean",
};

export default async function LitePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  const { error } = await searchParams;
  const { data } = await serverClient()
    .from("reports")
    .select("id, created_at, status, waste_type, road_issue, category, severity, zone, corporation")
    .order("created_at", { ascending: false })
    .limit(40);

  const field = "mt-1 block w-full rounded-lg border border-white/20 bg-black p-2.5 text-base text-white";
  return (
    <main className="mx-auto max-w-lg px-4 py-6 text-white">
      <h1 className="text-xl font-semibold">CleanLoop Lite</h1>
      <p className="mt-1 text-sm text-white/70">
        For slow connections. <Link href="/" className="underline">Full map</Link>
      </p>

      <h2 className="mt-6 text-base font-semibold">Report a dump spot</h2>
      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-[#ff6b5e]/50 p-2.5 text-sm text-[#ffb0a5]">
          {error}
        </p>
      )}
      <form action="/api/reports" method="post" encType="multipart/form-data" className="mt-3 space-y-3">
        <label className="block text-sm">
          Photo of the waste
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required className={field} />
        </label>
        <div className="flex gap-2">
          <label className="block flex-1 text-sm">
            Latitude
            <input name="lat" inputMode="decimal" required placeholder="12.97" className={field} />
          </label>
          <label className="block flex-1 text-sm">
            Longitude
            <input name="lng" inputMode="decimal" required placeholder="77.59" className={field} />
          </label>
        </div>
        <p className="text-xs text-white/55">Find these in your phone&apos;s map app: long-press the spot.</p>
        <label className="block text-sm">
          How bad is it?
          <select name="severity" required defaultValue="" className={field}>
            <option value="" disabled>Choose</option>
            <option value="1">1 — a few items</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5 — a heap blocking the road</option>
          </select>
        </label>
        <label className="block text-sm">
          Note (optional)
          <textarea name="description" maxLength={500} rows={2} className={field} />
        </label>
        <button className="min-h-11 w-full rounded-full bg-white py-3 font-semibold text-black">Submit report</button>
        <p className="text-xs text-white/55">Photos over 4 MB won&apos;t upload. You&apos;ll get a private link to follow the case.</p>
      </form>

      <h2 className="mt-8 text-base font-semibold">Recent cases</h2>
      <ul className="mt-2 divide-y divide-white/10 text-sm">
        {(data ?? []).map((r) => (
          <li key={r.id} className="py-2">
            <Link href={`/r/${r.id}`} className="underline-offset-2 hover:underline">
              <span className="capitalize">{r.category === "road" ? r.road_issue : r.waste_type}</span>, severity {r.severity}/5 ·{" "}
              {r.zone ?? "Bengaluru"} · {STATUS[r.status] ?? r.status} · {new Date(r.created_at).toLocaleDateString("en-IN")}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
