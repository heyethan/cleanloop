"use client";

/**
 * Report a dump spot — spec §3 Flow A, the ~30 second primary funnel.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports ReportSheet (default); POSTs multipart/form-data to /api/reports.
 * Data schemas: sends photo (File), lat, lng, session_id; receives a Report row
 * (created_at ISO-8601) plus ai_is_live and a recurring descriptor.
 * User instruction, verbatim: "also improve the ui/ux of the website"
 *
 * UX applied:
 *  - LABOR ILLUSION: the AI call takes 3-30s. A blank spinner reads as broken; a
 *    named sequence of steps reads as work being done, and makes the wait evidence
 *    of rigour rather than dead time.
 *  - PROGRESSIVE DISCLOSURE: photo first, location second, submit last.
 *  - PEAK-END: the confirmation is the end of this flow, so it states the promise
 *    ("you'll see this turn green") rather than just closing.
 */

import { useEffect, useMemo, useState } from "react";
import DictateButton from "./DictateButton";
import { getSessionId } from "@/lib/session";
import Sheet from "@/components/Sheet";
import { translate, type Lang } from "@/lib/i18n";
import { isInBengaluru } from "@/lib/wards";
import { downscalePhoto, readJson } from "@/lib/photo";
import type { Report } from "@/lib/types";
import { ThinkingOrb } from "thinking-orbs";

type Stage = "idle" | "locating" | "uploading" | "done" | "error";

/** Named steps for the Labor Illusion. Timings approximate the real pipeline. */
const WORK_STEPS = [
  "Uploading photo",
  "Identifying the waste",
  "Rating how bad it is",
  // Was "Checking 14-day history nearby" — 14 days is our dedupe rule, not the user's
  // concern. They care that we noticed it keeps happening.
  "Checking if this spot repeats",
  "Writing the complaint",
];

export default function ReportSheet({
  lang,
  onClose,
  onReported,
}: {
  lang: Lang;
  onClose: () => void;
  /** The created row, plus its GBA ward when the point is inside one. */
  onReported: (r: Report, ward: { name: string; zone: string } | null) => void;
}) {
  const t = (k: string, v?: Record<string, string | number>) => translate(lang, k, v);
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  /*
   * The two text fields are the source of truth and `coords` is derived from them, so
   * typing can never rewrite or clear what you are in the middle of typing. Holding a
   * parsed number in state was what made the inputs vanish after the first field.
   */
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const coords = useMemo(() => {
    if (latText.trim() === "" || lngText.trim() === "") return null;
    const lat = Number(latText);
    const lng = Number(lngText);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [latText, lngText]);
  const [message, setMessage] = useState<string | null>(null);
  /** Shown once: the reporter's private link to follow and confirm this case anonymously. */
  const [trackingCode, setTrackingCode] = useState<string | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [aiIsLive, setAiIsLive] = useState(true);
  const [wasRecurring, setWasRecurring] = useState(false);
  // The image model names the waste but cannot judge how bad it is, so the reporter does.
  const [severity, setSeverity] = useState<number | null>(null);
  /** Optional note, typed or dictated. Text only: no audio is ever kept. */
  const [description, setDescription] = useState("");
  /** Garbage dump (default) or road damage; roads also need which kind of damage. */
  const [category, setCategory] = useState<"waste" | "road">("waste");
  const [roadIssue, setRoadIssue] = useState<string>("");
  const [step, setStep] = useState(0);

  // Advance the visible work steps while the request is genuinely in flight.
  useEffect(() => {
    if (stage !== "uploading") return;
    setStep(0);
    const t = setInterval(
      () => setStep((s) => Math.min(s + 1, WORK_STEPS.length - 1)),
      1400,
    );
    return () => clearInterval(t);
  }, [stage]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function locate() {
    setStage("locating");
    setMessage(null);
    if (!navigator.geolocation) {
      setStage("idle");
      setMessage("This browser has no geolocation. Type the coordinates below.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Into the text fields, so the result is visible and editable rather than final.
        setLatText(pos.coords.latitude.toFixed(5));
        setLngText(pos.coords.longitude.toFixed(5));
        setStage("idle");
      },
      (err) => {
        setStage("idle");
        setMessage(`Location unavailable (${err.message}). Type it below.`);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit() {
    if (!file || !coords || !severity) return;
    setStage("uploading");
    setMessage(null);
    try {
      const fd = new FormData();
      /*
       * Downscale here rather than at pick time so the preview stays instant and the
       * work happens while the progress UI is already on screen.
       */
      fd.set("photo", await downscalePhoto(file));
      fd.set("lat", String(coords.lat));
      fd.set("lng", String(coords.lng));
      fd.set("severity", String(severity));
      if (description.trim()) fd.set("description", description.trim());
      fd.set("category", category);
      if (category === "road") fd.set("road_issue", roadIssue);
      fd.set("capture_mode", hasCamera ? "camera" : "gallery");
      fd.set("session_id", getSessionId());

      const res = await fetch("/api/reports", { method: "POST", body: fd });
      const json = await readJson<{
        report: Report;
        ai_is_live: boolean;
        tracking_code?: string;
        recurring: unknown;
        ward: { name: string; zone: string } | null;
      }>(res);

      setResult(json.report);
      if (json.tracking_code) {
        setTrackingCode(json.tracking_code);
        try {
          // Lets the case page recognise the reporter on this device without the link.
          localStorage.setItem(`cleanloop_code_${json.report.id}`, json.tracking_code);
        } catch {
          /* storage blocked: the private link below still works */
        }
      }
      setAiIsLive(json.ai_is_live);
      setWasRecurring(Boolean(json.recurring));
      setStage("done");
      onReported(json.report, json.ward);
    } catch (e) {
      setMessage((e as Error).message);
      setStage("error");
    }
  }

  /*
   * `coords` alone is not enough. It is already null until BOTH fields parse, so a
   * half-typed pair can no longer reach here as a real-looking point in the Atlantic, but
   * a perfectly valid coordinate outside the city still must not submit. Check the city,
   * not just presence.
   */
  const coordsValid = Boolean(coords && isInBengaluru(coords.lat, coords.lng));
  const canSubmit =
    Boolean(file) && coordsValid && Boolean(severity) && (category === "waste" || Boolean(roadIssue)) && stage !== "uploading";

  /*
   * A disabled button with no stated reason makes the user hunt for what they missed.
   * Name the single next thing instead — photo first, since it is step 1.
   */
  const blockedReason = !file
    ? t("needs_photo")
    : !coords
      ? t("needs_location")
      : !coordsValid
        ? t("location_outside")
        : !severity
          ? t("needs_severity")
          : null;

  /*
   * GPS starts the moment the sheet opens, so the location is usually ready by the time the
   * photo is picked. A refusal or timeout lands in the editable fields below, as before.
   * (Deferred a tick: locate() sets state, which must not happen synchronously in an effect.)
   */
  useEffect(() => {
    const id = window.setTimeout(locate, 0);
    return () => window.clearTimeout(id);
  }, []);

  /* Desktop has no camera; don't promise one. */
  const [hasCamera, setHasCamera] = useState(true);
  useEffect(() => {
    setHasCamera(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  return (
    <Sheet
      eyebrow={stage === "done" ? t("reported") : t("new_report")}
      title={stage === "done" ? t("on_the_map") : t("report_cta")}
      onClose={onClose}
    >
      {stage === "done" && result ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#22c98a]/25 bg-[#22c98a]/10 p-4">
            <div className="text-sm font-medium text-[#7df0c0]">
              You&apos;ll see this turn green when it&apos;s verified clean.
            </div>
            <div className="mt-1 text-[11px] text-[#7df0c0]/60">
              Nothing closes on someone&apos;s word — an after-photo has to pass AI
              verification first.
            </div>
          </div>

          {!aiIsLive && (
            <Notice tone="amber">
              No AI model is wired yet, so this classification is a placeholder, not a
              real analysis.
            </Notice>
          )}

          {trackingCode && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">Your private link</div>
              <p className="mt-1 text-xs text-white/70">
                Follow this case and confirm the cleanup from any device. Keep it — it isn&apos;t shown again.
              </p>
              <div className="mt-2 flex gap-2">
                <a
                  href={`/r/${result.id}?code=${trackingCode}`}
                  className="min-w-0 flex-1 truncate rounded-xl bg-black/30 px-3 py-2 font-mono text-[11px] text-white/80"
                >
                  {typeof window !== "undefined" ? window.location.origin : ""}/r/{result.id.slice(0, 8)}…?code={trackingCode}
                </a>
                <button
                  onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/r/${result.id}?code=${trackingCode}`)}
                  className="shrink-0 rounded-xl border border-white/15 px-3 text-xs text-white/80"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          <dl className="overflow-hidden rounded-2xl border border-white/10">
            <Row
              label={result.category === "road" ? (lang === "kn" ? "ರಸ್ತೆ ಸಮಸ್ಯೆ" : "Road issue") : t("waste_type")}
              value={(result.category === "road" ? result.road_issue : result.waste_type)?.replace("_", " ") ?? ""}
              capitalize
            />
            <Row label={t("severity_label")} value={`${result.severity} / 5`} />
            <Row
              label={t("history")}
              value={wasRecurring ? t("recurring_spot") : t("first_report")}
              accent={wasRecurring}
            />
          </dl>

          {result.complaint_text && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-white/55">
                Draft complaint
              </div>
              <textarea
                readOnly
                value={result.complaint_text}
                className="h-28 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-relaxed text-white/80 outline-none"
              />
              {/*
                Was "BBMP integration is a partnership, not a build" — a sentence about
                our roadmap, on a screen where someone is trying to file a complaint.
                The actionable half is all that remains.
              */}
              <p className="mt-1.5 text-[11px] text-white/55">
                Not sent automatically — copy this into the BBMP complaint channel.
              </p>
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.975]"
          >
            {t("done")}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* --- what is it: garbage or road damage --- */}
          <div className="flex gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1" role="radiogroup" aria-label="Report type">
            {(["waste", "road"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={category === c}
                onClick={() => setCategory(c)}
                className={`min-h-11 flex-1 rounded-full text-sm ${category === c ? "bg-white font-semibold text-black" : "text-white/70"}`}
              >
                {c === "waste" ? (lang === "kn" ? "ಕಸ" : "Garbage") : lang === "kn" ? "ರಸ್ತೆ ಹಾನಿ" : "Road damage"}
              </button>
            ))}
          </div>
          {category === "road" && (
            <label className="block text-[11px] uppercase tracking-[0.2em] text-white/55">
              {lang === "kn" ? "ಸಮಸ್ಯೆ" : "What's wrong"}
              <select
                value={roadIssue}
                onChange={(e) => setRoadIssue(e.target.value)}
                className="mt-2 block min-h-11 w-full rounded-xl border border-white/10 bg-[#0d1117] px-3 text-sm normal-case tracking-normal text-white"
              >
                <option value="" disabled>{lang === "kn" ? "ಆರಿಸಿ" : "Choose"}</option>
                <option value="pothole">{lang === "kn" ? "ಗುಂಡಿ" : "Pothole"}</option>
                <option value="damaged_surface">{lang === "kn" ? "ಹಾಳಾದ ರಸ್ತೆ ಮೇಲ್ಮೈ" : "Broken / crumbling surface"}</option>
                <option value="waterlogging">{lang === "kn" ? "ನೀರು ನಿಲ್ಲುವಿಕೆ" : "Waterlogging"}</option>
                <option value="debris">{lang === "kn" ? "ರಸ್ತೆಯ ಮೇಲೆ ಅವಶೇಷ" : "Debris on the road"}</option>
              </select>
            </label>
          )}

          {/* --- step 1: photo --- */}
          <div>
            <StepLabel n={1} label={t("photo")} done={Boolean(file)} />
            <label className="mt-2 block cursor-pointer">
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
                  <img src={preview} alt="Selected" className="h-40 w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 text-[11px] text-white/80">
                    Tap to change
                  </div>
                </div>
              ) : (
                <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-center">
                  <span className="text-xl">📷</span>
                  <span className="text-sm text-white/70">{t("take_photo")}</span>
                  {/*
                    "Camera opens directly" was shown on desktop, which has no camera —
                    a promise the device cannot keep. Coarse pointer is the honest proxy
                    for "this is a phone".
                  */}
                  <span className="text-[11px] text-white/55">
                    {hasCamera ? t("camera_opens") : t("choose_file")}
                  </span>
                </div>
              )}
            </label>
          </div>

          {/* --- step 2: location --- */}
          <div>
            <StepLabel n={2} label={t("location")} done={Boolean(coords)} />
            {/*
              Both routes are ALWAYS on screen, never behind a state flag.
              Typing a latitude made `coords` non-null, which flipped this to a
              "location set" summary and took the inputs away mid-entry. Manual entry was
              also only revealed when geolocation FAILED, but standing outside Bengaluru
              it SUCCEEDS, returns a good out-of-area fix, and the submit is refused with
              no obvious way to correct it. Two permanent inputs remove both dead ends.
            */}
            <div className="mt-2 space-y-2">
              <button
                onClick={locate}
                disabled={stage === "locating"}
                className="w-full rounded-2xl border border-white/12 bg-white/[0.05] py-3 text-sm text-white/85 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.985] disabled:opacity-50"
              >
                {stage === "locating" ? t("locating") : t("use_my_location")}
              </button>

              <div className="flex gap-2">
                {/*
                  Controlled, so a GPS result is visible and editable rather than trapped,
                  and paste works. Empty stays empty rather than becoming 0, which would be
                  a real-looking coordinate in the Gulf of Guinea.
                */}
                <input
                  aria-label="latitude"
                  placeholder="latitude"
                  inputMode="decimal"
                  value={latText}
                  onChange={(e) => setLatText(e.target.value)}
                  className="w-1/2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm tabular-nums text-white outline-none focus:border-white/25"
                />
                <input
                  aria-label="longitude"
                  placeholder="longitude"
                  inputMode="decimal"
                  value={lngText}
                  onChange={(e) => setLngText(e.target.value)}
                  className="w-1/2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm tabular-nums text-white outline-none focus:border-white/25"
                />
              </div>

              {coordsValid && coords && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs text-white/75">
                  {t("location_set")} · {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                </div>
              )}
            </div>
          </div>

          {/* --- optional note: type or speak (Kannada / English) --- */}
          <div>
            <label htmlFor="report-note" className="text-[11px] uppercase tracking-[0.2em] text-white/55">
              {lang === "kn" ? "ಟಿಪ್ಪಣಿ (ಐಚ್ಛಿಕ)" : "Note (optional)"}
            </label>
            <div className="mt-2 flex items-start gap-2">
              <textarea
                id="report-note"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                rows={2}
                placeholder={lang === "kn" ? "ಏನಿದೆ, ಎಷ್ಟು ದಿನದಿಂದ…" : "What's there, how long it's been…"}
                className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white outline-none focus:border-white/25"
              />
              <DictateButton lang={lang} onText={(t) => setDescription((d) => (d ? `${d} ${t}` : t).slice(0, 500))} />
            </div>
          </div>

          {/* --- step 3: severity --- */}
          <div>
            <StepLabel n={3} label={t("severity_label")} done={Boolean(severity)} />
            <div className="mt-2 flex gap-2" role="radiogroup" aria-label={t("severity_label")}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={severity === n}
                  aria-label={t("severity_of", { n })}
                  onClick={() => setSeverity(n)}
                  className={`flex-1 rounded-2xl border py-3 text-sm tabular-nums transition-colors ${
                    severity === n
                      ? "border-white bg-white text-black"
                      : "border-white/12 bg-white/[0.05] text-white/85"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-white/55">{t("severity_hint")}</p>
          </div>

          {/* LABOR ILLUSION: name the work instead of showing a blank spinner */}
          {stage === "uploading" && (
            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              {/*
               * The orb is the focal point the named steps lacked: it reads as "a model is
               * looking at your photo" in a way a list of ticks cannot. theme is pinned
               * rather than left "auto" because we set neither data-theme nor .dark, so auto
               * falls through to the OS preference and would paint dark ink on this sheet.
               */}
              <div className="flex justify-center pb-1">
                <ThinkingOrb state="searching" size={64} theme="dark" aria-label={t("analysing")} />
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

          {message && <Notice tone="red">{message}</Notice>}

          {/* Sticky: on a phone the form is taller than the sheet; Submit stays in reach. */}
          <div className="sticky bottom-0 -mx-1 bg-[#0b0f15] px-1 pb-1 pt-2">
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.975] disabled:bg-white/25 disabled:text-white/60"
          >
            {stage === "uploading" ? t("analysing") : t("submit_report")}
          </button>
          </div>

          {/*
            Say why the button is dead, and — when it isn't — say what submitting will
            actually do. Both claims are literally true: the report goes straight onto
            the public map, and the ward leaderboard is computed from days-to-verified.
            Deliberately does NOT claim it reaches BBMP, because nothing forwards it.
          */}
          <p className="mt-2 text-center text-[11px] leading-relaxed text-white/60">
            {blockedReason ?? t("after_submit")}
          </p>
        </div>
      )}
    </Sheet>
  );
}

function StepLabel({ n, label, done }: { n: number; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium ${
          done ? "bg-[#22c98a] text-black" : "bg-white/10 text-white/60"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <span className="text-[11px] uppercase tracking-[0.2em] text-white/60">
        {label}
      </span>
    </div>
  );
}

function Row({
  label,
  value,
  capitalize,
  accent,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.03] px-3.5 py-2.5 last:border-0">
      <dt className="text-xs text-white/60">{label}</dt>
      <dd
        className={`text-sm ${capitalize ? "capitalize" : ""} ${
          accent ? "text-[#ffb020]" : "text-white/90"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "amber" | "red";
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
