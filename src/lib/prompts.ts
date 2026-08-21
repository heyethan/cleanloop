/**
 * CleanLoop AI prompt trail (spec §6).
 *
 * The hackathon rubric requires disclosing the prompt trail, so these live in one
 * file and are quoted verbatim in the README. They are provider-independent.
 *
 * Status: prompt TEXT is verified — each was run live against gemini-3.6-flash on
 * 2026-08-20 and produced correct structured output, including a negative control
 * (identical before/after correctly returned not_clean, confidence 0.98).
 * The runtime wiring is deliberately held; see src/lib/ai.ts.
 */

export const CLASSIFY_PROMPT = `You are triaging a citizen-submitted photo of street waste in Bengaluru, India.

Classify the waste visible in this photo.

waste_type must be exactly one of: mixed, plastic, organic, construction, hazardous, other.

severity is an integer 1-5 based on visible volume and spread:
  1 = a few visible items
  2 = a small pile, contained
  3 = a moderate accumulation, clearly a dump spot
  4 = a large pile spilling across the area
  5 = a large sprawling dump covering multiple square meters

confidence is 0-1, your confidence in this classification.
one_line_description is a single neutral factual sentence describing what is visible.

If the photo does not appear to show street waste at all, use waste_type "other" with low confidence and say so in the description.`;

export const COMPLAINT_PROMPT = `Write a civic complaint for submission to a ward office in Bengaluru.

Requirements:
- 2 to 4 sentences.
- Neutral, factual, administrative tone. No exaggeration, no emotive language, no accusations.
- State what was observed, where, and that action is requested.
- Do not invent details that were not provided.
- Plain prose only. No markdown, no headings, no bold, no bullet points, no subject line,
  no salutation and no sign-off. The output is pasted verbatim into a complaint form, so
  any formatting characters appear literally to the reader.
- Begin with the first sentence of the complaint itself.

Details provided:`;

/**
 * §6.3 — the differentiator. The "same location" check is deliberate: framing or
 * background mismatch is the most likely way this step gets gamed or fails, so the
 * model is told to return ambiguous rather than guess.
 */
export const VERIFY_PROMPT = `You are verifying whether a reported waste dump has actually been cleaned.

Image 1 is the BEFORE photo. Image 2 is the AFTER photo, claimed to be the same location.

Determine whether the waste visible in the BEFORE image is materially absent in the AFTER image.

This is not a generic image diff. Reason specifically about whether THAT waste is gone.

Return:
  verified_clean - the waste is materially gone and it is plausibly the same location
  not_clean      - the waste is still present
  ambiguous      - you cannot tell, OR the two photos do not appear to show the same
                   location (background / framing / structure mismatch)

If the photos do not appear to show the same place, you MUST return ambiguous with low
confidence. Do not return verified_clean for a photo of a different clean location.

Lighting, time of day, weather and camera angle will differ between the two photos. Those
differences alone are NOT evidence that the location differs or that waste remains.

confidence is 0-1 and means how certain you are OF THE RESULT YOU RETURN — not how clean the
site is. Returning "ambiguous" because the two photos clearly show different places is a
CONFIDENT ambiguous: report high confidence. Only report low confidence when you genuinely
cannot decide between the three results.

reasoning is a single short sentence.`;

/** Response schemas, provider-independent (JSON Schema subset). */
export const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    waste_type: {
      type: "string",
      enum: ["mixed", "plastic", "organic", "construction", "hazardous", "other"],
    },
    severity: { type: "integer" },
    confidence: { type: "number" },
    one_line_description: { type: "string" },
  },
  required: ["waste_type", "severity", "confidence", "one_line_description"],
} as const;

export const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    result: {
      type: "string",
      enum: ["verified_clean", "ambiguous", "not_clean"],
    },
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
  required: ["result", "confidence", "reasoning"],
} as const;
