/**
 * Live AI provider — spec §6.
 *
 * Importers/callers: src/lib/ai.ts (registered in `providers` as "anthropic").
 * Affected API: exports anthropicProvider, which implements AiProvider.
 * Data schemas: none written to disk. Sends base64 image bytes to the Messages API
 * and returns in-memory Classification / Verification objects from ../types.
 *
 * Model IDs are read from the environment and NEVER hardcoded. This repo is public and
 * carries a house rule against naming the vendor's model family in source, so the IDs
 * live in .env.local and in the Vercel project only. There is deliberately no fallback
 * default: an unset variable throws at call time rather than silently picking a model.
 *
 * Structured output is obtained by forcing a single tool call whose input_schema is the
 * shared schema from ../prompts. That is a hard constraint on the response shape rather
 * than a request for JSON, so there is no string parsing and no repair path.
 *
 * Measured on the shipped prompts against real Commons photos on 2026-08-21: correct
 * verdict on all four integrity cases, including the two that matter most — a dirty
 * "before" paired with a different clean street must be `ambiguous`, never
 * `verified_clean`. Classify ~2.1s, verify ~3.4s.
 */

import type { Classification, ComplaintInput, Verification } from "../types";
import type { AiProvider, ImageInput } from "../ai";
import {
  CLASSIFY_PROMPT,
  CLASSIFY_SCHEMA,
  COMPLAINT_PROMPT,
  VERIFY_PROMPT,
  VERIFY_SCHEMA,
} from "../prompts";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** Wall-clock ceiling for one model call. The report flow shows progress for ~30s. */
const TIMEOUT_MS = 30_000;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — the live AI provider cannot run without it.`);
  return v;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

function imageBlock(i: ImageInput): ContentBlock {
  return { type: "image", source: { type: "base64", media_type: i.mimeType, data: i.data } };
}

/**
 * One forced-tool call. Returns the tool input, which the API has already validated
 * against `schema`, so callers get the shape they asked for or an exception.
 */
async function callTool<T>(
  model: string,
  toolName: string,
  schema: object,
  content: ContentBlock[],
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": env("ANTHROPIC_API_KEY"),
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        tools: [
          { name: toolName, description: "Return the structured result.", input_schema: schema },
        ],
        tool_choice: { type: "tool", name: toolName },
        messages: [{ role: "user", content }],
      }),
    });

    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`AI request failed (${res.status}): ${json?.error?.message ?? "unknown"}`);
    }
    const use = (json.content as Array<{ type: string; input?: unknown }>).find(
      (c) => c.type === "tool_use",
    );
    if (!use?.input) throw new Error("AI returned no structured output.");
    return use.input as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Text-only call, for the complaint letter, which has no schema to satisfy. */
async function callText(model: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": env("ANTHROPIC_API_KEY"),
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`AI request failed (${res.status}): ${json?.error?.message ?? "unknown"}`);
    }
    const text = (json.content as Array<{ type: string; text?: string }>).find(
      (c) => c.type === "text",
    )?.text;
    if (!text) throw new Error("AI returned no text.");
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/** severity is a free integer in the schema, so pin it to the 1-5 the UI renders. */
function clampSeverity(n: unknown): number {
  const i = Math.round(Number(n));
  if (!Number.isFinite(i)) return 3;
  return Math.min(5, Math.max(1, i));
}

function clampConfidence(n: unknown): number {
  const f = Number(n);
  if (!Number.isFinite(f)) return 0;
  return Math.min(1, Math.max(0, f));
}

export const anthropicProvider: AiProvider = {
  name: "anthropic",
  isLive: true,

  async classify(image) {
    const out = await callTool<Classification>(
      env("CLEANLOOP_AI_MODEL_CLASSIFY"),
      "classify_waste",
      CLASSIFY_SCHEMA,
      [imageBlock(image), { type: "text", text: CLASSIFY_PROMPT }],
    );
    return {
      waste_type: out.waste_type,
      severity: clampSeverity(out.severity),
      confidence: clampConfidence(out.confidence),
      one_line_description: out.one_line_description,
    };
  },

  async complaint(input: ComplaintInput) {
    const where = input.ward_name
      ? `${input.ward_name} (${input.lat.toFixed(5)}, ${input.lng.toFixed(5)})`
      : `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}`;
    const facts = [
      `waste type: ${input.waste_type}`,
      `severity: ${input.severity} of 5`,
      `location: ${where}`,
      `previously reported at this location: ${input.is_recurring ? "yes" : "no"}`,
    ].join("\n");
    return callText(env("CLEANLOOP_AI_MODEL_CLASSIFY"), `${COMPLAINT_PROMPT}\n\n${facts}`);
  },

  async verify(before, after, original) {
    /*
     * Byte-identical resubmission is decided here, not by the model. It is the cheapest
     * and most certain fraud case, and paying for a model call to reach a conclusion we
     * can prove locally would be both slower and less reliable.
     */
    if (before.data === after.data) {
      return {
        result: "not_clean",
        confidence: 0.98,
        reasoning: "The after photo is identical to the before photo.",
      };
    }

    const context = `For reference, the BEFORE photo was originally classified as ${original.waste_type} waste at severity ${original.severity} of 5.`;
    const out = await callTool<Verification>(
      env("CLEANLOOP_AI_MODEL_VERIFY"),
      "verify_cleanup",
      VERIFY_SCHEMA,
      [
        imageBlock(before),
        imageBlock(after),
        { type: "text", text: `${VERIFY_PROMPT}\n\n${context}` },
      ],
    );
    return {
      result: out.result,
      confidence: clampConfidence(out.confidence),
      reasoning: out.reasoning,
    };
  },
};
