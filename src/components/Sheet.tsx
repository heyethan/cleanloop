"use client";

/**
 * Shared bottom-sheet shell — glass, grab handle, weighted rise.
 *
 * Importers/callers: src/components/ReportSheet.tsx, ResolveSheet.tsx, Leaderboard.tsx.
 * Affected API: exports Sheet (default) taking {title, eyebrow?, onClose, children}.
 * Data schemas: none, presentational only.
 * User instruction, verbatim: "also improve the ui/ux of the website"
 *
 * Bottom-anchored on phones (thumb reach), centred dialog from sm: up.
 * Motion is CSS keyframes on transform/opacity only — no layout-triggering
 * properties, so it stays smooth on device.
 */

import { useEffect } from "react";

export default function Sheet({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Escape to dismiss, and lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        /*
          bg-black/70 over an already-dark map read as a solid black void — you lost
          all sense of where the sheet had come from. Apple's guidance is dim to
          focus, not black out: less opacity, more blur, so the map stays perceptible
          as a real layer behind glass and the sheet reads as sitting ON something.
        */
        className="veil-in absolute inset-0 bg-black/45 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="sheet-rise relative w-full sm:max-w-md">
        <div className="mx-auto max-h-[88dvh] overflow-hidden rounded-t-[2rem] border border-white/10 bg-white/[0.07] p-1.5 shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:rounded-[2rem]">
          <div className="max-h-[calc(88dvh-0.75rem)] overflow-y-auto rounded-t-[calc(2rem-0.375rem)] bg-[#0b0f15]/90 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] sm:rounded-[calc(2rem-0.375rem)]">
            {/* Grab handle — the affordance people expect on a phone sheet */}
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-white/20 sm:hidden" />

            <div className="flex items-start justify-between gap-4">
              <div>
                {eyebrow && (
                  <div className="text-[10px] uppercase tracking-[0.28em] text-white/55">
                    {eyebrow}
                  </div>
                )}
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">
                  {title}
                </h2>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-95"
              >
                ✕
              </button>
            </div>

            <div className="mt-5">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
