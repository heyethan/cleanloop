/**
 * The cleanloop wordmark: the two O's of "loop" are linked rings, amber (reported) then green
 * (verified). Same mark as src/app/icon.svg and the og:image.
 *
 * Importers/callers: src/components/MapLoader.tsx.
 */
export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span role="img" aria-label="CleanLoop" className={`inline-flex items-center font-semibold tracking-[-0.035em] ${className}`}>
      cleanl
      <svg viewBox="0 0 44 26" className="mx-px h-[0.68em]" aria-hidden>
        <circle cx="12" cy="13" r="9.5" fill="none" stroke="#ffb020" strokeWidth="4.2" />
        <circle cx="31" cy="13" r="9.5" fill="none" stroke="#22c98a" strokeWidth="4.2" />
      </svg>
      p
    </span>
  );
}
