/** Skeleton for /ops while the queue loads: same shape as the rows, no layout shift. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-6" aria-busy="true" aria-label="Loading the pickup queue">
      <div className="h-3 w-24 rounded bg-white/10" />
      <div className="mt-4 h-7 w-44 rounded bg-white/10" />
      <ul className="mt-8 space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex gap-3 rounded-2xl border border-white/10 p-2.5 motion-safe:animate-pulse">
            <div className="h-20 w-20 rounded-xl bg-white/10" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3.5 w-2/3 rounded bg-white/10" />
              <div className="h-3 w-1/2 rounded bg-white/[0.07]" />
              <div className="h-7 w-28 rounded-full bg-white/[0.07]" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
