/**
 * Image classifier trained on Teachable Machine, run on the server.
 *
 * Affected API: exports tmProvider, which implements AiProvider.
 *
 * It runs here and not in the browser on purpose: if the client decided "this is waste" or
 * "this is clean", anyone could POST a verified cleanup straight to the API — the exact
 * dishonest claim the product exists to reject.
 *
 * The model only sees one photo at a time and answers "which of these classes is it".
 * It cannot judge severity (the reporter picks that) and it cannot tell whether two photos
 * show the same place (the resolve route checks distance for that). Its labels come from
 * model/metadata.json and must match WasteType plus "not_garbage" and "irrelevant".
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import sharp from "sharp";
import type { WasteType } from "../types";
import type { AiProvider, ImageInput } from "../ai";
import { complaintText } from "../complaint.ts";

const MODEL_DIR = path.join(process.cwd(), "model");
const NOT_GARBAGE = "not_garbage";
/**
 * Screenshots, documents, rooms, food: not a photo of a place at all. Without this class the
 * model had to file them under not_garbage, so a phone screenshot read as "the spot is clean".
 */
const IRRELEVANT = "irrelevant";

/** The after photo must be this sure it shows no waste before a cleanup turns green. */
export const CLEAN_THRESHOLD = 0.75;

interface Loaded {
  model: tf.LayersModel;
  labels: string[];
  size: number;
}

let loading: Promise<Loaded> | null = null;

async function load(): Promise<Loaded> {
  const [modelJson, meta] = await Promise.all([
    readFile(path.join(MODEL_DIR, "model.json"), "utf8").then(JSON.parse),
    readFile(path.join(MODEL_DIR, "metadata.json"), "utf8").then(JSON.parse),
  ]);
  // TM exports one weights shard; read whatever model.json names so a re-export still loads.
  const paths: string[] = modelJson.weightsManifest.flatMap((g: { paths: string[] }) => g.paths);
  const shards = await Promise.all(paths.map((p) => readFile(path.join(MODEL_DIR, p))));
  const weightData = Buffer.concat(shards);
  const model = await tf.loadLayersModel(
    tf.io.fromMemory({
      modelTopology: modelJson.modelTopology,
      weightSpecs: modelJson.weightsManifest.flatMap((g: { weights: unknown[] }) => g.weights),
      weightData: weightData.buffer.slice(
        weightData.byteOffset,
        weightData.byteOffset + weightData.byteLength,
      ),
    }),
  );
  return { model, labels: meta.labels, size: meta.imageSize ?? 224 };
}

/** Class name → probability for one photo. Exported for the evaluation script. */
export async function predict(image: ImageInput): Promise<Record<string, number>> {
  loading ??= load().catch((e) => {
    loading = null; // let the next request retry instead of caching the failure
    throw e;
  });
  const { model, labels, size } = await loading;

  // Same preprocessing as TM: centre square crop, resize, scale pixels to [-1, 1].
  const raw = await sharp(Buffer.from(image.data, "base64"))
    .rotate() // honour EXIF orientation from phone cameras
    .resize(size, size, { fit: "cover", position: "centre" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const probs = tf.tidy(() => {
    const input = tf
      .tensor3d(new Uint8Array(raw), [size, size, 3], "int32")
      .toFloat()
      .div(127.5)
      .sub(1)
      .expandDims(0);
    return (model.predict(input) as tf.Tensor).dataSync();
  });
  return Object.fromEntries(labels.map((l, i) => [l, probs[i]]));
}

function topWaste(p: Record<string, number>): [WasteType, number] {
  const [label, score] = Object.entries(p)
    .filter(([l]) => l !== NOT_GARBAGE && l !== IRRELEVANT)
    .sort((a, b) => b[1] - a[1])[0];
  return [label as WasteType, score];
}

export const tmProvider: AiProvider = {
  name: "tm",
  isLive: true,

  async classify(image) {
    const p = await predict(image);
    if ((p[IRRELEVANT] ?? 0) >= 0.5) {
      return {
        is_waste: false,
        waste_type: "other",
        severity: 1,
        confidence: p[IRRELEVANT],
        one_line_description:
          "This isn't a photo of a street or a dump spot. Take a photo of the waste where it is.",
      };
    }
    const clean = p[NOT_GARBAGE] ?? 0;
    const [wasteType, score] = topWaste(p);
    if (clean >= 0.5) {
      return {
        is_waste: false,
        waste_type: "other",
        severity: 1,
        confidence: clean,
        one_line_description:
          "This photo doesn't look like a waste dump. Take it so the waste fills most of the frame.",
      };
    }
    return {
      is_waste: true,
      waste_type: wasteType,
      // The model cannot judge severity; the report route replaces this with the reporter's pick.
      severity: 3,
      confidence: score,
      one_line_description: `Looks like ${wasteType} waste.`,
    };
  },

  // A classifier writes no prose, so the complaint comes from the shared template.
  async complaint(input) {
    return complaintText(input);
  },

  async verify(before, after) {
    if (before.data === after.data) {
      return {
        result: "not_clean",
        confidence: 0.98,
        reasoning: "The after photo is identical to the before photo.",
      };
    }
    const p = await predict(after);
    if ((p[IRRELEVANT] ?? 0) >= 0.5) {
      return {
        result: "not_clean",
        confidence: p[IRRELEVANT],
        reasoning: "This isn't a photo of the spot. Take the after photo where the waste was.",
      };
    }
    const clean = p[NOT_GARBAGE] ?? 0;
    if (clean >= CLEAN_THRESHOLD) {
      return {
        result: "verified_clean",
        confidence: clean,
        reasoning: "The after photo shows no visible waste.",
      };
    }
    if (clean <= 1 - CLEAN_THRESHOLD) {
      return {
        result: "not_clean",
        confidence: 1 - clean,
        reasoning: "Waste is still visible in the after photo.",
      };
    }
    return {
      result: "ambiguous",
      confidence: clean,
      reasoning: "The after photo isn't clear enough to confirm the spot is clean.",
    };
  },
};
