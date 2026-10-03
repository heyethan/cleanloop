"use client";

/**
 * The phone island: a draggable bottom sheet with three heights — peek (stats + search),
 * half, full. The map stays touchable above it.
 *
 * Importers/callers: src/app/page.tsx (below the 1024px desktop breakpoint only).
 * Affected API: exports BottomSheet (default) and the Snap type. Presentational: the caller owns
 * the snap state, so "collapse the chrome" (a case opens, a flight starts) is one setState.
 *
 * Drag is on the handle strip only, so scrolling the sheet's content never fights the gesture.
 * Release snaps to the nearest height, biased by flick direction. Height (not transform) moves,
 * so the map's visible area really grows; it is a single element and the transition is CSS.
 */
import { useRef, useState } from "react";

export type Snap = "peek" | "half" | "full";

const PEEK_PX = 168;
const heightOf = (s: Snap) =>
  s === "peek" ? PEEK_PX : s === "half" ? Math.round(window.innerHeight * 0.5) : Math.round(window.innerHeight * 0.88);

export default function BottomSheet({
  snap,
  onSnap,
  label,
  children,
}: {
  snap: Snap;
  onSnap: (s: Snap) => void;
  label: string;
  children: React.ReactNode;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number; t: number } | null>(null);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const h = heightOf(snap);
    start.current = { y: e.clientY, h, t: performance.now() };
    setDrag(h);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDrag(Math.max(PEEK_PX - 40, Math.min(window.innerHeight * 0.92, start.current.h + start.current.y - e.clientY)));
  };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    setDrag(null);
    if (!s) return;
    const dy = s.y - e.clientY;
    // A tap on the handle cycles up; a flick moves one step in its direction.
    if (Math.abs(dy) < 6) return onSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "peek");
    const v = dy / Math.max(1, performance.now() - s.t);
    const order: Snap[] = ["peek", "half", "full"];
    if (Math.abs(v) > 0.6) {
      const i = order.indexOf(snap) + (v > 0 ? 1 : -1);
      return onSnap(order[Math.max(0, Math.min(2, i))]);
    }
    const h = s.h + dy;
    onSnap(order.reduce((best, o) => (Math.abs(heightOf(o) - h) < Math.abs(heightOf(best) - h) ? o : best), "peek"));
  };

  return (
    <section
      aria-label={label}
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[1.75rem] border-t border-white/10 bg-[#0b0f15] shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.9)]"
      style={{
        height: drag ?? (snap === "peek" ? PEEK_PX : snap === "half" ? "50dvh" : "88dvh"),
        transition: drag === null ? "height 420ms cubic-bezier(0.32,0.72,0,1)" : "none",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label}: ${snap}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "peek");
          }
        }}
        className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center"
      >
        <span className="h-1 w-10 rounded-full bg-white/25" />
      </div>
      <div
        className={`min-h-0 flex-1 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${snap === "peek" && drag === null ? "overflow-hidden" : "overflow-y-auto"}`}
      >
        {children}
      </div>
    </section>
  );
}
