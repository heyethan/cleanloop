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

import { useEffect, useState } from "react";
import { getSessionId } from "@/lib/session";
import Sheet from "@/components/Sheet";
import type { Report } from "@/lib/types";

type Stage = "idle" | "locating" | "uploading" | "done" | "error";

/** Named steps for the Labor Illusion. Timings approximate the real pipeline. */
const WORK_STEPS = [
  "Uploading photo",
  "Classifying waste type",
  "Scoring severity",
  "Checking 14-day history nearby",
  "Drafting civic complaint",
];

export default function ReportSheet({
  onClose,
  onReported,
}: {
  onClose: () => void;
  onReported: (r: Report) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [manual, setManual] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [aiIsLive, setAiIsLive] = useState(true);
  const [wasRecurring, setWasRecurring] = useState(false);
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
      setManual(true);
      setStage("idle");
      setMessage("This browser has no geolocation. Enter coordinates manually.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStage("idle");
      },
      (err) => {
        setManual(true);
        setStage("idle");
        setMessage(`Location unavailable (${err.message}). Enter it manually.`);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit() {
    if (!file || !coords) return;
    setStage("uploading");
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set("photo", file);
      fd.set("lat", String(coords.lat));
      fd.set("lng", String(coords.lng));
      fd.set("session_id", getSessionId());

      const res = await fetch("/api/reports", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);

      setResult(json.report);
      setAiIsLive(json.ai_is_live);
      setWasRecurring(Boolean(json.recurring));
      setStage("done");
      onReported(json.report);
    } catch (e) {
      setMessage((e as Error).message);
      setStage("error");
    }
  }

  const canSubmit = Boolean(file && coords) && stage !== "uploading";

  return (
    <Sheet
      eyebrow={stage === "done" ? "Reported" : "New report"}
      title={stage === "done" ? "On the map" : "Report a dump spot"}
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

          <dl className="overflow-hidden rounded-2xl border border-white/10">
            <Row label="Waste type" value={result.waste_type} capitalize />
            <Row label="Severity" value={`${result.severity} / 5`} />
            <Row
              label="History"
              value={wasRecurring ? "Recurring spot" : "First report here"}
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
              <p className="mt-1.5 text-[11px] text-white/55">
                Not filed automatically — BBMP integration is a partnership, not a
                build. Copy this into the official channel.
              </p>
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.975]"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* --- step 1: photo --- */}
          <div>
            <StepLabel n={1} label="Photo" done={Boolean(file)} />
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
                  <span className="text-sm text-white/70">Take or choose a photo</span>
                  <span className="text-[11px] text-white/55">Camera opens directly</span>
                </div>
              )}
            </label>
          </div>

          {/* --- step 2: location --- */}
          <div>
            <StepLabel n={2} label="Location" done={Boolean(coords)} />
            {coords ? (
              <div className="mt-2 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                <span className="font-mono text-xs text-white/75">
                  {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                </span>
                <button
                  onClick={() => {
                    setCoords(null);
                    setManual(true);
                  }}
                  className="text-[11px] text-white/60 underline-offset-4 hover:text-white/80"
                >
                  change
                </button>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <button
                  onClick={locate}
                  disabled={stage === "locating"}
                  className="w-full rounded-2xl border border-white/12 bg-white/[0.05] py-3 text-sm text-white/85 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.985] disabled:opacity-50"
                >
                  {stage === "locating" ? "Locating…" : "Use my location"}
                </button>
                {manual && (
                  <div className="flex gap-2">
                    <input
                      placeholder="latitude"
                      inputMode="decimal"
                      className="w-1/2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white outline-none"
                      onChange={(e) =>
                        setCoords((c) => ({
                          lat: Number(e.target.value),
                          lng: c?.lng ?? 0,
                        }))
                      }
                    />
                    <input
                      placeholder="longitude"
                      inputMode="decimal"
                      className="w-1/2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white outline-none"
                      onChange={(e) =>
                        setCoords((c) => ({
                          lat: c?.lat ?? 0,
                          lng: Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* LABOR ILLUSION: name the work instead of showing a blank spinner */}
          {stage === "uploading" && (
            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
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

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="w-full rounded-full bg-white py-3.5 text-[15px] font-semibold text-black transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.975] disabled:bg-white/25 disabled:text-white/50"
          >
            {stage === "uploading" ? "Analysing…" : "Submit report"}
          </button>
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
          done ? "bg-[#22c98a] text-black" : "bg-white/10 text-white/50"
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
