"use client";

/**
 * Submit an "after" photo and show the AI verdict — spec §3 Flow B.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports ResolveSheet (default);
 * POSTs multipart/form-data to /api/reports/[id]/resolve.
 * Data schemas: sends photo (File), session_id; receives {verification, status,
 * is_self_resolved, ai_is_live} plus the Resolution row (submitted_at/verified_at ISO-8601).
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * The three outcomes are shown honestly and differently. A yellow "claimed, unverified"
 * is not dressed up as success — that distinction is the entire product argument.
 */

import { useState } from "react";
import { getSessionId } from "@/lib/session";
import type { Report, ReportStatus, Verification } from "@/lib/types";

export default function ResolveSheet({
  report,
  onClose,
  onResolved,
}: {
  report: Report;
  onClose: () => void;
  onResolved: (id: string, status: ReportStatus) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const [selfResolved, setSelfResolved] = useState(false);
  const [aiIsLive, setAiIsLive] = useState(true);

  async function submit() {
    if (!file) {
      setError("Choose an after photo first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("photo", file);
      fd.set("session_id", getSessionId());
      const res = await fetch(`/api/reports/${report.id}/resolve`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);

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

  const verdictStyle =
    status === "verified_resolved"
      ? "bg-green-50 text-green-900"
      : "bg-amber-50 text-amber-900";

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Verify cleanup</h2>
          <button onClick={onClose} className="text-2xl leading-none text-neutral-400">
            ×
          </button>
        </div>

        <div className="mt-3 space-y-1 text-sm text-neutral-600">
          <div className="capitalize">
            {report.waste_type} waste · severity {report.severity}/5
          </div>
          {report.ai_description && (
            <div className="text-xs text-neutral-500">{report.ai_description}</div>
          )}
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={report.photo_before_url}
          alt="Before"
          className="mt-3 h-40 w-full rounded-lg object-cover"
        />
        <div className="mt-1 text-xs text-neutral-500">Before</div>

        {verification ? (
          <div className="mt-4 space-y-3">
            <div className={`rounded-lg p-3 text-sm ${verdictStyle}`}>
              <div className="font-semibold">
                {status === "verified_resolved"
                  ? "Verified clean — pin is now green"
                  : "Claimed, unverified — pin stays open"}
              </div>
              <div className="mt-1 text-xs">
                AI result: {verification.result} · confidence{" "}
                {(verification.confidence * 100).toFixed(0)}%
              </div>
              <div className="mt-1 text-xs">{verification.reasoning}</div>
            </div>

            {status !== "verified_resolved" && (
              <p className="text-xs text-neutral-600">
                The model was not confident enough to close this. It stays open for a
                human moderator or a second after photo — CleanLoop does not close a case
                on an unverified claim.
              </p>
            )}

            {selfResolved && (
              <div className="rounded-lg bg-neutral-100 p-2 text-xs text-neutral-700">
                Flagged: resolved by the same session that reported it.
              </div>
            )}

            {!aiIsLive && (
              <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                No AI model is wired yet — this verdict is a placeholder, not a real
                visual comparison.
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
              <label className="mb-1 block text-sm font-medium">After photo</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{error}</div>
            )}

            <button
              onClick={submit}
              disabled={busy || !file}
              className="w-full rounded-lg bg-neutral-900 py-2.5 text-white disabled:opacity-40"
            >
              {busy ? "Comparing before and after…" : "Submit for verification"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
