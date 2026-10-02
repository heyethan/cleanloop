/**
 * Road reports: what the image model's scores mean for intake and for a repair photo.
 *
 * Affected API: exports roadIntake(), roadVerdict(). Used by the report and resolve routes for
 * category "road" (scores from src/lib/providers/tm.ts predict()); checked in selfcheck.
 * Same shape as waste: a problem photo is required to report; a repair is verified only when the
 * after photo is a good road ≥ 0.75 AND the scene matches the before photo (≥ 0.30); the route
 * adds the 50 m GPS check on top.
 */
import { SCENE_MATCH_THRESHOLD } from "./sceneThreshold.ts";
import type { Verification } from "./types.ts";

type Scores = Record<string, number | undefined>;
const n = (p: Scores, k: string) => p[k] ?? 0;

export function roadIntake(p: Scores): { ok: boolean; reason: string } {
  if (n(p, "irrelevant") >= 0.5) return { ok: false, reason: "This isn't a photo of a road. Take a photo of the damage where it is." };
  const problem = n(p, "pothole") + n(p, "damaged_road");
  if (problem >= 0.5) return { ok: true, reason: "Road damage visible." };
  return { ok: false, reason: "This road doesn't look damaged. Get the pothole or broken surface in the frame." };
}

export function roadVerdict(after: Scores, sceneMatch: number): Verification {
  if (n(after, "irrelevant") >= 0.5) {
    return { result: "not_clean", confidence: n(after, "irrelevant"), reasoning: "This isn't a photo of the road. Take the after photo where the damage was." };
  }
  const good = n(after, "good_road");
  if (good >= 0.75) {
    return sceneMatch >= SCENE_MATCH_THRESHOLD
      ? { result: "verified_clean", confidence: good, reasoning: "The road surface looks repaired." }
      : { result: "ambiguous", confidence: good, reasoning: "The road looks fine, but it doesn't look like the same place as the report." };
  }
  if (good <= 0.25) {
    return { result: "not_clean", confidence: 1 - good, reasoning: "The damage is still visible in the after photo." };
  }
  return { result: "ambiguous", confidence: good, reasoning: "The after photo isn't clear enough to confirm the repair." };
}
