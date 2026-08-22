/**
 * CleanLoop AI prompt trail (spec §6).
 *
 * The hackathon rubric requires disclosing the prompt trail, so these live in one
 * file and are quoted verbatim in the README. They are provider-independent.
 *
 * Status: verified live. Each prompt has been run against the configured provider and
 * returns correct structured output, including a negative control (an identical
 * before/after pair correctly returns not_clean at high confidence). Structured output is
 * obtained by forcing a tool call against the schemas below, so nothing here asks for JSON
 * in prose and no response needs parsing or repair.
 *
 * The model identifier is never named here — it is read from the environment in
 * src/lib/providers/, so these prompts stay provider-independent in fact, not just intent.
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

is_waste is the FIRST thing to decide: true only if this photograph shows actual waste at a
real location. Set it false for anything else — a screenshot, a diagram or flowchart, a photo
of a screen or a document, a selfie, an indoor scene, a blank wall or floor, or any image
where no waste is present. When in doubt about whether something is waste, set it false; a
rejected photo costs someone one retake, whereas a false report is filed to a ward office.

confidence is 0-1 and means how certain you are OF THE ANSWER YOU GIVE, including the
is_waste decision. Being certain that an image is NOT waste is HIGH confidence, not low.

one_line_description is a single neutral factual sentence describing what is visible. When
is_waste is false, say plainly what the image actually shows instead.

waste_type and severity are only meaningful when is_waste is true. When it is false, use
"other" and 1.`;

export const COMPLAINT_PROMPT = `Write a civic complaint for submission to a ward office in Bengaluru.

Requirements:
- 2 to 4 sentences.
- Neutral, factual, administrative tone. No exaggeration, no emotive language, no accusations.
- State what was observed, where, and that action is requested.
- Do not invent details that were not provided. Describe only what the observation below
  states. If it does not mention a kind of waste, do not name one.
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
    /*
     * Asked explicitly rather than inferred from waste_type === "other", because "other"
     * legitimately means unusual waste. A photo of a flowchart on a monitor was classified
     * `other` / severity 1 / confidence 0.95 with the description "not street waste" — the
     * model was right and the app filed it anyway. Make the model state the decision.
     */
    is_waste: { type: "boolean" },
    waste_type: {
      type: "string",
      enum: ["mixed", "plastic", "organic", "construction", "hazardous", "other"],
    },
    severity: { type: "integer" },
    confidence: { type: "number" },
    one_line_description: { type: "string" },
  },
  required: ["is_waste", "waste_type", "severity", "confidence", "one_line_description"],
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
