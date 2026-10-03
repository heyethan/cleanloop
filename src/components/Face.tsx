"use client";

/**
 * An official's face, or their initials when there is no photo or it fails to load (several
 * photos are hotlinked from government sites that may block them).
 *
 * Importers/callers: src/components/ResolveSheet.tsx, src/components/OfficialsIsland.tsx.
 * Affected API: exports Face (default). Presentational, no data fetching.
 */
import { useState } from "react";

export function initials(name: string): string {
  return name.replace(/^Dr\.?\s+/, "").split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
}

export default function Face({ name, photo, size }: { name: string; photo: string | null; size: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#1b2330] text-[11px] font-medium text-white/80"
      style={{ width: size, height: size }}
    >
      {initials(name)}
      {photo && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

