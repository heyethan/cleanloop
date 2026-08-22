"use client";

/**
 * The sponsor evidence pack, presentation only.
 *
 * Importers/callers: src/app/impact/[ward]/page.tsx (its only caller).
 * Affected API: exports ImpactPack (default) plus the Rejection and Outcome prop types.
 * Data schemas: none read or written — receives already-derived plain objects and writes only
 *   a client-side CSV Blob.
 * User instruction, verbatim: "If we need to build something or add on something to the
 *   existing product platform to showcase revenue or business model, then do it."
 *
 * WHY A CLIENT LEAF
 *
 * src/lib/i18n.ts is "use client", so a Server Component cannot call translate(). Rather than
 * split that module (five importers, hours before a pitch), the route does data only and every
 * pixel is rendered here.
 *
 * NOT wrapped in Sheet.tsx: that is a modal (fixed inset-0, locks body scroll, requires
 * onClose). This is a page. The glass recipe is reused verbatim; the shell is not.
 */

import { useLang } from "@/lib/i18n";

// Same literals page.tsx and ListView.tsx use. Kept local rather than imported because they
// are duplicated there too — unifying them is a separate change, not this one's job.
const AMBIGUOUS = "#ffb020";
const NOT_CLEAN = "#ff3b30";
const VERIFIED = "#22c98a";

export interface Rejection {
  id: string;
  before: string | null;
  after: string;
  verdict: string;
  reasoning: string | null;
  submitted_at: string;
  lat: number | null;
  lng: number | null;
}

export interface Outcome {
  id: string;
  before: string;
  after: string | null;
  verified_at: string;
  days_to_verify: number;
  lat: number;
  lng: number;
}

/** Concentric radii — outer shell 2rem, inner core 2rem minus the 0.375rem shell padding. */
const SHELL = "rounded-[2rem] border border-white/10 bg-white/[0.07] p-1.5 backdrop-blur-2xl";
const CORE =
  "rounded-[calc(2rem-0.375rem)] bg-[#0b0f15]/90 px-5 py-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function coords(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return null;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export default function ImpactPack({
  wardId,
  wardName,
  failed,
  hasAnyReports,
  rejections,
  outcomes,
  watched,
  refilled,
  medianHeld,
  fee,
  costPerOutcome,
}: {
  wardId: string;
  wardName: string;
  failed: boolean;
  hasAnyReports: boolean;
  rejections: Rejection[];
  outcomes: Outcome[];
  watched: number;
  refilled: number;
  medianHeld: number | null;
  fee: number;
  costPerOutcome: number | null;
}) {
  const { t } = useLang();

  /*
   * Built client-side so the auditor's file is one click with no round trip. Both sections
   * share one file with a `section` column — an auditor wants one artefact, not two.
   */
  function exportCsv() {
    /*
     * Quoting is not enough. Excel, Sheets and LibreOffice evaluate a cell that begins with
     * = + - or @ as a FORMULA even when the CSV quoted it, so model-written ai_reasoning could
     * become executable in the auditor's spreadsheet. A leading apostrophe neutralises it
     * without changing the text the auditor sees. This file exists to be opened in Excel, so
     * the risk is the realistic case rather than the exotic one.
     */
    const esc = (v: unknown) => {
      let s = String(v ?? "");
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows: string[][] = [
      [
        "section",
        "date",
        "verdict",
        "latitude",
        "longitude",
        "days",
        "reasoning",
        "before_photo",
        "after_photo",
      ],
      ...rejections.map((r) => [
        "rejected_claim",
        r.submitted_at,
        r.verdict,
        String(r.lat ?? ""),
        String(r.lng ?? ""),
        "",
        r.reasoning ?? "",
        r.before ?? "",
        r.after,
      ]),
      ...outcomes.map((o) => [
        "verified_outcome",
        o.verified_at,
        "verified_clean",
        String(o.lat),
        String(o.lng),
        String(o.days_to_verify),
        "",
        o.before,
        o.after ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cleanloop-evidence-${wardId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      {/* A page reached by a link needs a way back, or it is a dead end. */}
      <a
        href="/"
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-[13px] text-white/70 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/10 hover:text-white active:scale-[0.98]"
      >
        <span aria-hidden="true">←</span>
        {t("back_to_map")}
      </a>

      <header className="mt-6">
        <p className="text-[10px] uppercase tracking-[0.28em] text-white/55">
          {t("impact_eyebrow")}
        </p>
        <h1 className="mt-1.5 text-balance text-[2rem] font-semibold leading-[1.05] tracking-[-0.02em] text-white">
          {wardName}
        </h1>
      </header>

      {failed && (
        <section className={`${SHELL} mt-6`}>
          <div className={CORE}>
            <p className="text-[15px] leading-relaxed text-white/70">{t("impact_error")}</p>
          </div>
        </section>
      )}

      {!failed && !hasAnyReports && (
        <section className={`${SHELL} mt-6`}>
          <div className={CORE}>
            <p className="text-[15px] leading-relaxed text-white/70">{t("impact_empty")}</p>
          </div>
        </section>
      )}

      {!failed && hasAnyReports && (
        <>
          {/*
            THE HERO — first, above every positive number. A sponsor's reason to pay is not
            that we count cleanups; it is that we refuse the ones that do not hold up.
          */}
          <section className={`${SHELL} mt-6`} aria-labelledby="rejected-heading">
            <div className={CORE}>
              <div className="flex items-baseline justify-between gap-4">
                <h2
                  id="rejected-heading"
                  className="text-[17px] font-semibold tracking-tight text-white"
                >
                  {t("rejected_claims")}
                </h2>
                <span className="text-2xl font-semibold tabular-nums text-white">
                  {rejections.length}
                </span>
              </div>
              <p className="mt-2 text-pretty text-[13px] leading-relaxed text-white/60">
                {t("rejected_note")}
              </p>

              {rejections.length === 0 ? (
                <p className="mt-5 text-[14px] leading-relaxed text-white/50">
                  {t("rejected_none")}
                </p>
              ) : (
                <ul className="mt-5 space-y-5">
                  {rejections.map((r) => {
                    const isNotClean = r.verdict === "not_clean";
                    const tone = isNotClean ? NOT_CLEAN : AMBIGUOUS;
                    const label = isNotClean ? t("verdict_not_clean") : t("verdict_ambiguous");
                    const where = coords(r.lat, r.lng) ?? wardName;
                    return (
                      <li
                        key={r.id}
                        className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <div className="grid grid-cols-2 gap-1.5">
                          {r.before && (
                            <figure className="m-0">
                              <img
                                src={r.before}
                                alt={`Waste reported at ${where} before the cleanup was claimed`}
                                loading="lazy"
                                className="aspect-square w-full rounded-xl object-cover"
                              />
                              <figcaption className="mt-1.5 text-[11px] text-white/45">
                                {t("before")}
                              </figcaption>
                            </figure>
                          )}
                          <figure className="m-0">
                            <img
                              src={r.after}
                              alt={`Photo submitted as proof the waste at ${where} had been cleared`}
                              loading="lazy"
                              className="aspect-square w-full rounded-xl object-cover"
                            />
                            <figcaption className="mt-1.5 text-[11px] text-white/45">
                              {t("after")}
                            </figcaption>
                          </figure>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span
                            className="rounded-md px-2 py-1 text-[11px] font-medium"
                            style={{ color: tone, backgroundColor: `${tone}1f` }}
                          >
                            {label}
                          </span>
                          <span className="text-[11px] tabular-nums text-white/45">
                            {fmtDate(r.submitted_at)}
                          </span>
                          {/* /55 not /35: coordinates are evidence an auditor reads, and
                              white/35 on this panel measures 3.18:1 — below the 4.5:1 floor. */}
                          {coords(r.lat, r.lng) && (
                            <span className="font-mono text-[11px] tabular-nums text-white/55">
                              {coords(r.lat, r.lng)}
                            </span>
                          )}
                        </div>

                        {r.reasoning && (
                          <p className="mt-2.5 text-pretty text-[13px] leading-relaxed text-white/65">
                            {r.reasoning}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className={`${SHELL} mt-4`} aria-labelledby="outcomes-heading">
            <div className={CORE}>
              <div className="flex items-baseline justify-between gap-4">
                <h2
                  id="outcomes-heading"
                  className="text-[17px] font-semibold tracking-tight text-white"
                >
                  {t("verified_outcomes")}
                </h2>
                <span
                  className="text-2xl font-semibold tabular-nums"
                  style={{ color: VERIFIED }}
                >
                  {outcomes.length}
                </span>
              </div>

              {outcomes.length === 0 ? (
                <p className="mt-4 text-[14px] leading-relaxed text-white/50">
                  {t("outcomes_none")}
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {outcomes.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5"
                    >
                      <img
                        src={o.after ?? o.before}
                        alt={`Verified clean at ${coords(o.lat, o.lng)}`}
                        loading="lazy"
                        className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      />
                      <div className="min-w-0">
                        <div className="text-[13px] tabular-nums text-white/80">
                          {fmtDate(o.verified_at)}
                        </div>
                        {/* /55 not /40 — white/40 measures 3.82:1 here, below the 4.5:1 floor. */}
                        <div className="mt-0.5 font-mono text-[11px] tabular-nums text-white/55">
                          {coords(o.lat, o.lng)}
                        </div>
                      </div>
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-white/45">
                        {t("days_to_verify", { n: o.days_to_verify })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className={`${SHELL} mt-4`} aria-labelledby="durability-heading">
            <div className={CORE}>
              <h2
                id="durability-heading"
                className="text-[17px] font-semibold tracking-tight text-white"
              >
                {t("durability_heading")}
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-white/80">
                <span className="text-2xl font-semibold tabular-nums text-white">{watched}</span>{" "}
                {t("spots_under_watch")} ·{" "}
                <span
                  className="text-2xl font-semibold tabular-nums"
                  style={{ color: refilled > 0 ? NOT_CLEAN : VERIFIED }}
                >
                  {refilled}
                </span>{" "}
                {t("spots_refilled_n")}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-white/55">
                {medianHeld == null ? t("never_refilled") : t("median_held", { n: medianHeld })}
              </p>
            </div>
          </section>

          {/* Cost — the assumption is on screen and editable rather than hidden in a slide. */}
          <section className={`${SHELL} mt-4`} aria-labelledby="cost-heading">
            <div className={CORE}>
              <h2
                id="cost-heading"
                className="text-[17px] font-semibold tracking-tight text-white"
              >
                {t("cost_heading")}
              </h2>
              <p className="mt-3 text-[2rem] font-semibold leading-none tabular-nums text-white">
                {costPerOutcome == null ? "—" : `₹${costPerOutcome.toLocaleString("en-IN")}`}
              </p>
              {costPerOutcome == null && (
                <p className="mt-2 text-[13px] leading-relaxed text-white/55">
                  {t("cost_no_outcomes")}
                </p>
              )}

              <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
                <label className="flex-1 text-[12px] text-white/55">
                  {t("fee_assumption")}
                  <input
                    type="number"
                    name="fee"
                    min={1}
                    step={1000}
                    defaultValue={fee}
                    className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[15px] tabular-nums text-white outline-none transition-colors duration-200 focus:border-white/25"
                  />
                </label>
                <button
                  type="submit"
                  className="min-h-11 rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/15 active:scale-[0.98]"
                >
                  {t("fee_apply")}
                </button>
              </form>
              <p className="mt-2.5 text-pretty text-[12px] leading-relaxed text-white/45">
                {t("fee_disclaimer")}
              </p>
            </div>
          </section>

          <button
            onClick={exportCsv}
            className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3.5 text-[14px] font-medium text-white backdrop-blur-2xl transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/[0.12] active:scale-[0.99]"
          >
            {t("export_csv")}
          </button>
        </>
      )}
    </main>
  );
}
