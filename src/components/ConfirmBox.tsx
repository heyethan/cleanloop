"use client";

/**
 * The reporter's "was it really cleaned?" answer on the case page.
 *
 * Importers/callers: src/app/r/[id]/page.tsx (only while a case is awaiting_confirmation).
 * POSTs to /api/reports/[id]/confirm with this browser's session id and/or the private tracking
 * code (from ?code= or saved by ReportSheet under localStorage "cleanloop_code_<id>").
 * The server decides who the reporter is; this box just asks.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSessionId } from "@/lib/session";

export default function ConfirmBox({ id, codeFromUrl, daysLeft }: { id: string; codeFromUrl: string | null; daysLeft: number | null }) {
  const router = useRouter();
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /** The private link's code, or the copy this device saved when it reported the case. */
  function savedCode(): string | null {
    if (codeFromUrl) return codeFromUrl;
    try {
      return localStorage.getItem(`cleanloop_code_${id}`);
    } catch {
      return null; // storage blocked: only the private link works
    }
  }

  async function send(action: "confirm" | "dispute") {
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("action", action);
    fd.set("session_id", getSessionId());
    const code = savedCode();
    if (code) fd.set("code", code);
    if (action === "dispute") {
      fd.set("note", note);
      if (photo) fd.set("photo", photo);
    }
    const res = await fetch(`/api/reports/${id}/confirm`, { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(json.error ?? "Something went wrong. Try again.");
    router.refresh();
  }

  const days = daysLeft;
  return (
    <section className="rounded-2xl border border-[#8fe3bf]/30 bg-[#8fe3bf]/10 p-4">
      <h2 className="text-sm font-semibold text-[#c8f5e1]">Did you report this? Is it really clean?</h2>
      <p className="mt-1 text-xs leading-relaxed text-white/65">
        The after photo passed verification. Only you can close it.
        {days !== null && ` If you don't answer within ${days} day${days === 1 ? "" : "s"}, it closes automatically and is marked that way.`}
      </p>
      {!disputing ? (
        <div className="mt-3 flex gap-2">
          <button disabled={busy} onClick={() => send("confirm")} className="flex-1 rounded-full bg-white py-3 text-sm font-semibold text-black disabled:opacity-50">
            Yes, it&apos;s clean
          </button>
          <button disabled={busy} onClick={() => setDisputing(true)} className="flex-1 rounded-full border border-white/20 py-3 text-sm text-white/85">
            No, it isn&apos;t
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="What's still wrong? (optional)"
            className="h-20 w-full rounded-xl border border-white/15 bg-black/20 p-3 text-sm text-white outline-none focus:border-white/40"
          />
          <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 px-3 py-2.5 text-xs text-white/70">
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            {photo ? `Photo: ${photo.name}` : "Add a photo of how it looks now (optional)"}
          </label>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => send("dispute")} className="flex-1 rounded-full bg-[#ff6b5e] py-3 text-sm font-semibold text-black disabled:opacity-50">
              Reopen the case
            </button>
            <button disabled={busy} onClick={() => setDisputing(false)} className="rounded-full border border-white/20 px-4 text-sm text-white/70">
              Back
            </button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-[#ffb0a5]">{msg}</p>}
      {!codeFromUrl && (
        <p className="mt-2 text-[11px] text-white/45">Reported from another device? Open the private link you got when you reported.</p>
      )}
    </section>
  );
}
