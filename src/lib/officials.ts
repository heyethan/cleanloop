/**
 * Who is responsible for a case: the most specific named official, escalating upward.
 *
 * Affected API: exports Official, OFFICIALS_FALLBACK_EMAIL, pickOfficial(). Used by the report
 * route (email recipient + case card) and the performance page; checked in scripts/selfcheck.ts.
 * Data: the `officials` table (schema-v3.sql), seeded by scripts/seed-officials.ts from
 * official sources only, each row carrying source_url and verified_at.
 *
 * Order: ward -> zone -> corporation -> city. A post with no published name is skipped, so a
 * case never shows a blank where a named person exists one level up.
 */

export interface Official {
  level: "ward" | "zone" | "corporation" | "city";
  ward_id: string | null;
  zone: string | null;
  corporation: string | null;
  category: "waste" | "road" | "all";
  role: string;
  name: string | null;
  photo_url: string | null;
  email: string | null;
  source_url: string | null;
  verified_at: string | null;
}

/** The only verified official complaint address (GBA). Used when no official has an email. */
export const OFFICIALS_FALLBACK_EMAIL = "comm@bbmp.gov.in";

const LEVELS: Official["level"][] = ["ward", "zone", "corporation", "city"];

export function pickOfficial(
  officials: Official[],
  ward: { id: string; zone_name: string; corporation: string },
  category: "waste" | "road",
): Official | null {
  const matchesArea = (o: Official) =>
    o.level === "ward" ? o.ward_id === ward.id
    : o.level === "zone" ? o.zone === ward.zone_name
    : o.level === "corporation" ? o.corporation === ward.corporation
    : true;
  for (const level of LEVELS) {
    const hit = officials.find(
      (o) => o.level === level && o.name && (o.category === category || o.category === "all") && matchesArea(o),
    );
    if (hit) return hit;
  }
  return null;
}
