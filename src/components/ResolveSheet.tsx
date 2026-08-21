"use client";

/**
 * Submit an "after" photo and show the AI verdict — spec §3 Flow B.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports ResolveSheet (default);
 * POSTs multipart/form-data to /api/reports/[id]/resolve.
 * Data schemas: sends photo (File), session_id; receives {verification, status,
 * is_self_resolved, ai_is_live} plus the Resolution row (ISO-8601 timestamps).
 * User instruction, verbatim: "also improve the ui/ux of the website"
 *
 * UX applied:
 *  - FRAMING: a non-green outcome is "Held for review", never "failed". The
 *    integrity of refusing to close on an unverified claim IS the product.
 *  - PEAK-END: the green verdict is the emotional peak of the whole product, so it
 *    gets the largest, brightest, most animated treatment in the app.
 *  - AUTHORITY/TRANSPARENCY: the model's own reasoning is shown verbatim.
 */

import { useEffect, useState } from "react";
import { getSessionId } from "@/lib/session";
import Sheet from "@/components/Sheet";
import { translate, type Lang } from "@/lib/i18n";
import type { Report, ReportStatus, Verification } from "@/lib/types";
import { ThinkingOrb } from "thinking-orbs";
import { downscalePhoto, readJson } from "@/lib/photo";

const WORK_STEPS = [
  "Uploading your photo",
  "Comparing before and after",
  "Checking it's the same place",
];

export default function ResolveSheet({
  lang,
  report,
  onClose,
  onResolved,
}: {
  lang: Lang;
  report: Report;
  onClose: () => void;
  onResolved: (id: string, status: ReportStatus) => void;
}) {
  const t = (k: string, v?: Record<string, string | number>) => translate(lang, k, v);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const [selfResolved, setSelfResolved] = useState(false);
  const [aiIsLive, setAiIsLive] = useState(true);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(
      () => setStep((s) => Math.min(s + 1, WORK_STEPS.length - 1)),
      1500,
    );
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      // Same 413 trap as the report flow — an "after" photo is just as likely to be 8 MB.
      fd.set("photo", await downscalePhoto(file));
      fd.set("session_id", getSessionId());
      const res = await fetch(`/api/reports/${report.id}/resolve`, {
        method: "POST",
        body: fd,
      });
      const json = await readJson<{
        verification: Verification;
        status: ReportStatus;
        is_self_resolved: boolean;
        ai_is_live: boolean;
      }>(res);

      setVerification(json.verification);
      setStatus(json.status);
      setSelfResolved(json.is_self_resolved);
      setAiIsLive(json.ai_is_live);
      onResolved(report.id, json.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isGreen = status === "verified_resolved";
  const alreadyDone = report.status === "verified_resolved";

  return (
    <Sheet
      eyebrow={verification ? t("verification_result") : t("close_the_loop")}
      title={verification ? (isGreen ? t("status_verified") : t("held_for_review")) : t("verify_cleanup")}
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* --- the original report --- */}
        <div className="overflow-hidden rounded-2xl border border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={report.photo_before_url}
            alt="Before"
            className="h-40 w-full object-cover"
          />
          <div className="flex items-center justify-between bg-white/[0.04] px-3.5 py-2.5">
            <span className="text-xs capitalize text-white/80">
              {report.waste_type} · severity {report.severity}/5
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/55">
              {t("before")}
            </span>
          </div>
        </div>

        {report.ai_description && (
          <p className="text-[11px] leading-relaxed text-white/60">
            {report.ai_description}
          </p>
        )}

        {verification ? (
          <>
            {/* PEAK MOMENT */}
            <div
              className={`rounded-2xl border p-4 ${
                isGreen
                  ? "border-[#22c98a]/30 bg-[#22c98a]/10"
                  : "border-[#ffb020]/30 bg-[#ffb020]/10"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                    isGreen ? "bg-[#22c98a] text-black" : "bg-[#ffb020] text-black"
                  }`}
                >
                  {isGreen ? "✓" : "!"}
                </span>
                <div
                  className={`text-sm font-semibold ${
                    isGreen ? "text-[#7df0c0]" : "text-[#ffd591]"
                  }`}
                >
                  {isGreen ? t("pin_now_green") : t("case_stays_open")}
                </div>
              </div>

              {/*
                The raw enum ("verified_clean") used to be shown in a monospace chip.
                That is a database value, not language — the heading directly above
                already says the outcome in words. Only the certainty survives, because
                that is the part a citizen actually weighs.
              */}
              <div className="mt-3 text-[11px] text-white/60">
                {t("certainty", { n: (verification.confidence * 100).toFixed(0) })}
              </div>

              <p className="mt-2.5 text-[11px] leading-relaxed text-white/60">
                {verification.reasoning}
              </p>
            </div>

            {!isGreen && (
              <p className="text-[11px] leading-relaxed text-white/60">
                The model wasn&apos;t confident enough to close this. That&apos;s
                deliberate — CleanLoop never closes a case on an unverified claim. It
                stays open for a moderator or a second after-photo.
              </p>
            )}

            {selfResolved && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-[11px] text-white/60">
                Flagged: resolved by the same session that reported it.
              </div>
            )}

            {/*
              KEPT, but rewritten out of engineering language. "No AI model is wired yet"
              describes our build state; "Demo mode" describes the user's situation. The
              notice itself has to stay: without it the screen presents a simulated
              verdict as a real photo comparison, which is the one lie this product
              cannot tell.
            */}
            {!aiIsLive && (
              <Notice>Demo mode — this result is simulated, not a real comparison.</Notice>
            )}

            <button
              onClick={onClose}
              className="w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.975]"
            >
              {t("done")}
            </button>
          </>
        ) : alreadyDone ? (
          /*
            THE PROOF SURFACE.

            This branch used to be a single line — "This spot is already verified
            clean." — with no after photo, no verdict, no confidence and no reasoning.
            Verified closure is the one thing this product does that a plain reporting
            app does not, and the screen a citizen reaches by tapping a green pin is
            exactly where that claim has to be evidenced. A bare assertion of
            cleanliness is precisely the unaccountable "we fixed it" the product exists
            to replace.
          */
          <ExistingProof reportId={report.id} lang={lang} />
        ) : (
          <>
            <label className="block cursor-pointer">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
              {preview ? (
                <div className="relative overflow-hidden rounded-2xl border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="After" className="h-40 w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 text-[11px] text-white/80">
                    After · tap to change
                  </div>
                </div>
              ) : (
                <div className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/15 bg-white/[0.03]">
                  <span className="text-lg">📷</span>
                  <span className="text-sm text-white/70">{t("after_photo")}</span>
                </div>
              )}
            </label>

            {busy && (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                {/*
                 * "solving" rather than "searching": this call is the before/after
                 * comparison, which is the one thing here a generic waste app doesn't do.
                 * Worth showing as deliberation, not lookup.
                 */}
                <div className="flex justify-center pb-1">
                  <ThinkingOrb state="solving" size={64} theme="dark" aria-label={t("comparing")} />
                </div>
                {WORK_STEPS.map((s, i) => (
                  <div
                    key={s}
                    className={`flex items-center gap-2.5 text-xs transition-opacity duration-500 ${
                      i <= step ? "opacity-100" : "opacity-30"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
                        i < step
                          ? "bg-[#22c98a] text-black"
                          : i === step
                            ? "animate-pulse bg-white/80 text-black"
                            : "bg-white/10 text-white/55"
                      }`}
                    >
                      {i < step ? "✓" : i + 1}
                    </span>
                    <span className={i <= step ? "text-white/85" : "text-white/55"}>
                      {s}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {error && <Notice tone="red">{error}</Notice>}

            <button
              onClick={submit}
              disabled={busy || !file}
              className="w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.975] disabled:bg-white/25 disabled:text-white/60"
            >
              {busy ? t("comparing") : t("submit_for_verification")}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

interface StoredResolution {
  photo_after_url: string;
  ai_verification_result: string;
  ai_confidence: number;
  ai_reasoning: string | null;
  verified_at: string | null;
  is_self_resolved: boolean;
  is_genuine_pair: boolean;
}

/**
 * The evidence behind an already-closed case: the after photo, the verdict, the
 * confidence it cleared, and the model's stated reasoning.
 *
 * Fetched on open rather than carried in the report payload — /api/reports returns one
 * row per pin and most pins are still open, so joining a resolution onto every one of
 * them would be paying for the rare case on every request.
 */
function ExistingProof({ reportId, lang }: { reportId: string; lang: Lang }) {
  const t = (k: string, v?: Record<string, string | number>) => translate(lang, k, v);
  const [res, setRes] = useState<StoredResolution | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/reports/${reportId}/resolve`);
        const j = await r.json();
        if (!alive) return;
        if (j.resolution) {
          setRes(j.resolution);
          setState("ok");
        } else {
          setState("missing");
        }
      } catch {
        if (alive) setState("missing");
      }
    })();
    return () => {
      alive = false;
    };
  }, [reportId]);

  if (state === "loading") {
    return (
      <div className="flex h-40 items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04]">
        <ThinkingOrb state="working" size={20} theme="dark" aria-label={t("loading")} />
        <span className="text-xs text-white/55">{t("loading")}</span>
      </div>
    );
  }

  /*
   * Status says verified but no record came back. Say exactly that rather than
   * asserting cleanliness we cannot evidence — an unbacked green claim here would be
   * the very thing this screen exists to prevent.
   */
  if (state === "missing" || !res) {
    return (
      <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-200">
        {t("proof_missing")}
      </div>
    );
  }

  const pct = Math.round(res.ai_confidence * 100);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-[#22c98a]/25">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={res.photo_after_url} alt="After" className="h-40 w-full object-cover" />
        <div className="flex items-center justify-between bg-[#22c98a]/10 px-3.5 py-2.5">
          <span className="text-xs font-medium text-[#7df0c0]">
            {t("status_verified")}
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/60">
            {t("after")}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
        {/* Same reasoning as above: the enum is internal, the certainty is not. */}
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-white/60">{t("certainty", { n: String(pct) })}</span>
          {res.verified_at && (
            <span className="ml-auto text-white/55">
              {new Date(res.verified_at).toLocaleDateString()}
            </span>
          )}
        </div>
        {res.ai_reasoning && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-white/60">
            {res.ai_reasoning}
          </p>
        )}
      </div>

      {res.is_self_resolved && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-[11px] text-white/60">
          {t("self_resolved_flag")}
        </div>
      )}

      {/* Seeded pairs are two different photographs, and the UI must keep saying so. */}
      {!res.is_genuine_pair && <Notice>{t("not_genuine_pair")}</Notice>}
    </div>
  );
}

function Notice({
  tone = "amber",
  children,
}: {
  tone?: "amber" | "red";
  children: React.ReactNode;
}) {
  const cls =
    tone === "amber"
      ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
      : "border-red-400/25 bg-red-400/10 text-red-200";
  return (
    <div className={`rounded-2xl border p-3 text-[11px] leading-relaxed ${cls}`}>
      {children}
    </div>
  );
}
