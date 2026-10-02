/**
 * Minimum before/after scene similarity for a "same place" verdict (calibrated 2026-10-01 on 17
 * real same-spot pairs vs 77 mismatched pairs). Its own module so pure verdict code can use it
 * without loading the tfjs provider. Re-exported by src/lib/providers/tm.ts.
 */
export const SCENE_MATCH_THRESHOLD = 0.3;
