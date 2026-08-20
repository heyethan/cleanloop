"use client";

/**
 * Report a dump spot — spec §3 Flow A, the ~30 second primary funnel.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports ReportSheet (default); POSTs multipart/form-data to /api/reports.
 * Data schemas: sends photo (File), lat, lng, session_id; receives a Report row
 * (created_at ISO-8601) plus ai_is_live and a recurring descriptor.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * No login by design (§3 Flow A step 1). Geolocation is captured automatically with a
 * manual lat/lng fallback when permission is denied (§4, P1).
 */

import { useState } from "react";
import { getSessionId } from "@/lib/session";
import type { Report } from "@/lib/types";

type Stage = "idle" | "locating" | "uploading" | "done" | "error";

export default function ReportSheet({
  onClose,
  onReported,
}: {
  onClose: () => void;
  onReported: (r: Report) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [manual, setManual] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [aiIsLive, setAiIsLive] = useState<boolean>(true);
  const [wasRecurring, setWasRecurring] = useState(false);

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
        // Denied permission is the common case — fall back, don't dead-end.
        setManual(true);
        setStage("idle");
        setMessage(`Location unavailable (${err.message}). Enter it manually.`);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit() {
    if (!file) {
      setMessage("Take or choose a photo first.");
      return;
    }
    if (!coords) {
      setMessage("Set a location first.");
      return;
    }
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

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Report a dump spot</h2>
          <button onClick={onClose} className="text-2xl leading-none text-neutral-400">
            ×
          </button>
        </div>

        {stage === "done" && result ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
              Reported. You&apos;ll see this turn green when it&apos;s verified clean.
            </div>

            {!aiIsLive && (
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                No AI model is wired yet, so the classification below is a placeholder,
                not a real analysis.
              </div>
            )}

            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-neutral-500">Waste type</dt>
                <dd className="capitalize">{result.waste_type}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Severity</dt>
                <dd>{result.severity} / 5</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Recurring</dt>
                <dd>
                  {wasRecurring ? "Yes — reported here before" : "First report here"}
                </dd>
              </div>
            </dl>

            {result.complaint_text && (
              <div>
                <div className="mb-1 text-sm font-medium">Draft complaint</div>
                <textarea
                  readOnly
                  value={result.complaint_text}
                  className="h-28 w-full rounded border p-2 text-xs"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Submission to BBMP is not integrated — copy this into the official
                  channel. See README.
                </p>
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full rounded-lg bg-neutral-900 py-2.5 text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Photo</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full cursor-pointer rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:text-white"
              />
              {file && (
                <p className="mt-1 truncate text-xs text-neutral-500">{file.name}</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Location</label>
              {coords ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs">
                    {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                  </span>
                  <button
                    onClick={() => {
                      setCoords(null);
                      setManual(true);
                    }}
                    className="text-xs text-blue-600"
                  >
                    change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={locate}
                    disabled={stage === "locating"}
                    className="w-full rounded-lg border py-2 text-sm disabled:opacity-50"
                  >
                    {stage === "locating" ? "Locating…" : "Use my location"}
                  </button>
                  {manual && (
                    <div className="flex gap-2">
                      <input
                        placeholder="latitude"
                        inputMode="decimal"
                        className="w-1/2 rounded border p-2 text-sm"
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
                        className="w-1/2 rounded border p-2 text-sm"
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

            {message && (
              <div className="rounded-lg bg-red-50 p-2 text-xs text-red-800">
                {message}
              </div>
            )}

            <button
              onClick={submit}
              disabled={stage === "uploading" || !file || !coords}
              className="w-full rounded-lg bg-neutral-900 py-2.5 text-white disabled:opacity-40"
            >
              {stage === "uploading" ? "Analysing…" : "Submit report"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
