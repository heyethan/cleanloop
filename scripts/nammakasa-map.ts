/**
 * Map one NammaKasa case (nammakasa.in, data stated as CC-BY) to a CleanLoop report row.
 *
 * Affected API: exports NammaKasaRow, mapNammaKasa(). Used by scripts/import-nammakasa.ts;
 * checked in scripts/selfcheck.ts.
 * Only public, non-personal fields are copied: location, address, category, severity, status,
 * photo link, dates, ward. Reporter/resolver names, notes, moderation metadata and device
 * fingerprints are never read into the output. Every row carries source + attribution + link.
 */
import { wardAt } from "../src/lib/gbaWards.ts";

export interface NammaKasaRow {
  id: string;
  latitude: number;
  longitude: number;
  address?: string | null;
  severity?: string | null;
  category?: string | null;
  status?: string | null;
  resolution_status?: string | null;
  photo_url?: string | null;
  created_at: string;
  [other: string]: unknown;
}

const CATEGORY: Record<string, string> = {
  household: "organic",
  construction: "construction",
  biomedical: "hazardous",
  mixed: "mixed",
};
const SEVERITY: Record<string, number> = { medium: 2, large: 3, massive: 5, critical: 5 };

export function mapNammaKasa(r: NammaKasaRow) {
  const ward = wardAt(r.latitude, r.longitude);
  if (!ward || !r.photo_url) return null;
  const resolved = r.status === "resolved" && r.resolution_status !== "rejected";
  return {
    photo_before_url: r.photo_url,
    lat: r.latitude,
    lng: r.longitude,
    ward_id: null,
    gba_ward_id: ward.id,
    corporation: ward.corporation,
    zone: ward.zone_name,
    category: "waste" as const,
    waste_type: CATEGORY[r.category ?? ""] ?? "mixed",
    severity: SEVERITY[r.severity ?? ""] ?? 3,
    status: resolved ? ("verified_resolved" as const) : ("open" as const),
    is_recurring: false,
    description: r.address ? `Location: ${String(r.address).slice(0, 200)}` : null,
    created_at: r.created_at,
    is_seed: false,
    capture_mode: "import",
    source: "nammakasa",
    source_id: r.id,
    source_attribution: "NammaKasa (CC-BY) — nammakasa.in",
    source_url: "https://nammakasa.in",
  };
}
