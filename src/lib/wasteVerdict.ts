/**
 * Garbage reports on the 10-class model: is it waste, which kind, and how "clean" is a photo.
 *
 * Affected API: exports WASTE_CLASSES, wasteIntake(), cleanScore(). Used by
 * src/lib/providers/tm.ts (classify/verify); checked in scripts/selfcheck.ts.
 * The model also knows roads (pothole, damaged_road, good_road). A clean street often splits its
 * score between not_garbage and good_road, so "clean" is their sum; and a pothole reported as
 * garbage is refused with a pointer to the road report instead of being filed as waste.
 */
import type { WasteType } from "./types.ts";

type Scores = Record<string, number | undefined>;
const n = (p: Scores, k: string) => p[k] ?? 0;
export const WASTE_CLASSES: WasteType[] = ["mixed", "plastic", "organic", "construction", "hazardous"];

export const cleanScore = (p: Scores) => n(p, "not_garbage") + n(p, "good_road");

export function wasteIntake(p: Scores): { ok: boolean; waste_type: WasteType; confidence: number; reason: string } {
  const waste = WASTE_CLASSES.reduce((sum, c) => sum + n(p, c), 0);
  const top = [...WASTE_CLASSES].sort((a, b) => n(p, b) - n(p, a))[0];
  if (n(p, "irrelevant") >= 0.5) {
    return { ok: false, waste_type: "other", confidence: n(p, "irrelevant"), reason: "This isn't a photo of a street or a dump spot. Take a photo of the waste where it is." };
  }
  if (waste >= 0.5) return { ok: true, waste_type: top, confidence: waste, reason: `Looks like ${top} waste.` };
  if (n(p, "pothole") + n(p, "damaged_road") >= 0.5) {
    return { ok: false, waste_type: "other", confidence: 1 - waste, reason: "This looks like road damage, not garbage. Switch to “Road damage” to report it." };
  }
  return { ok: false, waste_type: "other", confidence: 1 - waste, reason: "This photo doesn't look like a waste dump. Take it so the waste fills most of the frame." };
}
