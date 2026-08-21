/**
 * Photo preparation and response parsing for the two upload flows.
 *
 * Importers/callers: src/components/ReportSheet.tsx, src/components/ResolveSheet.tsx.
 * Affected API: exports downscalePhoto(), readJson(), MAX_UPLOAD_BYTES.
 * Data schemas: none. Operates on in-memory File/Blob and on fetch Responses.
 *
 * WHY THIS EXISTS — a real user hit this on production:
 *
 *   Unexpected token 'R', "Request En"... is not valid JSON
 *
 * The serverless platform rejects a request body over ~4.5 MB with a PLAINTEXT 413
 * ("Request Entity Too Large" / FUNCTION_PAYLOAD_TOO_LARGE) before the route handler runs.
 * Measured against production on 2026-08-21: 3 MB reached the handler, 5 / 8 / 12 MB all
 * returned 413. The client then called res.json() on that plaintext and threw a parse
 * error, so a routine "photo too big" reached the citizen as gibberish.
 *
 * Two independent defects, so two independent fixes:
 *   1. downscalePhoto — stop sending 4 MB+ bodies at all. Modern phone cameras produce
 *      4-12 MB JPEGs, so this was luck-of-the-camera, not an edge case.
 *   2. readJson — never assume a response is JSON. A 413, a gateway HTML page and a
 *      cold-start timeout are all non-JSON, and all must still produce a readable message.
 *
 * The server's own size check cannot help here: it lives inside the function, and the
 * platform rejects the body before the function is ever invoked.
 */

/**
 * Longest edge after downscaling. Waste classification needs to see a pile of rubbish, not
 * read a number plate, so 1600px is generous. A 1600px JPEG at q0.82 is typically 300-800 KB
 * — an order of magnitude under the platform ceiling, and much faster on mobile data.
 */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

/**
 * Hard client-side ceiling, set below the ~4.5 MB platform limit rather than at it. The
 * multipart envelope and the other form fields consume headroom, so sitting flush against
 * the real limit would still 413.
 */
export const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

/** Progressively lower quality, used only if the first pass is somehow still too big. */
const FALLBACK_QUALITY = [0.7, 0.55, 0.4];

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Downscale a camera photo to something the upload path can actually carry.
 *
 * Returns the ORIGINAL file unchanged if anything goes wrong (an exotic codec, a browser
 * without createImageBitmap, a decode failure). That is deliberate: an oversized photo
 * still has some chance of succeeding, whereas throwing here would block a report that
 * might have gone through. The server and readJson() remain the backstop.
 */
export async function downscalePhoto(file: File): Promise<File> {
  // Already small and already JPEG — nothing to gain, and re-encoding only loses quality.
  if (file.size <= MAX_UPLOAD_BYTES && file.type === "image/jpeg") return file;

  try {
    if (typeof createImageBitmap !== "function") return file;

    /*
     * imageOrientation: "from-image" applies the EXIF rotation tag. Without it a photo
     * taken in portrait on a phone decodes sideways, because the canvas ignores EXIF —
     * an upright original would be uploaded rotated.
     */
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    let blob = await canvasToBlob(canvas, QUALITY);
    for (const q of FALLBACK_QUALITY) {
      if (blob && blob.size <= MAX_UPLOAD_BYTES) break;
      blob = await canvasToBlob(canvas, q);
    }
    if (!blob) return file;

    // A small original can encode LARGER after a round trip. Never make things worse.
    if (blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

/**
 * Parse a fetch Response that is *supposed* to be JSON, without assuming it is.
 *
 * Throws an Error whose message is safe to show a citizen. The raw body is deliberately
 * never surfaced: "Request Entity Too Large" and a stack of gateway HTML are both noise to
 * someone trying to report a rubbish pile.
 */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (res.status === 413) {
      throw new Error("That photo is too large to upload. Try taking it again.");
    }
    if (res.status >= 500) {
      throw new Error("The server had a problem. Please try again in a moment.");
    }
    throw new Error(`Something went wrong (error ${res.status}). Please try again.`);
  }

  const body = parsed as { error?: string; detail?: string };
  if (!res.ok || body?.error) {
    /*
     * `detail` carries the classifier's own sentence about the photo ("This image shows a
     * flowchart diagram ... not street waste"). Showing it beats a bare refusal, because it
     * tells the person what we actually saw and therefore what to re-shoot.
     */
    const msg = body?.error ?? `Something went wrong (error ${res.status}).`;
    throw new Error(body?.detail ? `${msg} ${body.detail}` : msg);
  }
  return parsed as T;
}
