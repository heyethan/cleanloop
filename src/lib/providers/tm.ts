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
 * It cannot judge severity (the reporter picks that). Same place is checked twice: the scene
 * match below compares the two photos, and the resolve route checks GPS distance. Its labels come from
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

import { SCENE_MATCH_THRESHOLD } from "../sceneThreshold.ts";
export { SCENE_MATCH_THRESHOLD };

interface Loaded {
  model: tf.LayersModel;
  /** MobileNet trunk up to its last spatial feature map (before pooling): the scene layout. */
  scene: tf.LayersModel;
  labels: string[];
  size: number;
}

/*
 * One model per PROCESS, not per module copy. Next bundles each route separately, so two routes
 * (report, resolve) can each import this file into the same server process; tfjs keeps one
 * global variable registry, and a second load fails with "Variable with name Conv1/kernel was
 * already registered". Keeping the promise on globalThis makes every copy share the first load.
 */
const g = globalThis as unknown as { __cleanloopTm?: Promise<Loaded> | null };

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
  // TM nests the MobileNet trunk as the first layer. Its last 4-D output keeps *where* things
  // are (road, wall, skyline), which is what survives a cleanup; pooling would throw that away.
  const trunk = model.layers[0] as tf.Sequential;
  const spatial = [...trunk.layers].reverse().find((l) => (l.outputShape as number[]).length === 4)!;
  const scene = tf.model({ inputs: trunk.inputs, outputs: spatial.output as tf.SymbolicTensor });
  return { model, scene, labels: meta.labels, size: meta.imageSize ?? 224 };
}

function ready(): Promise<Loaded> {
  g.__cleanloopTm ??= load().catch((e) => {
    g.__cleanloopTm = null; // let the next request retry instead of caching the failure
    throw e;
  });
  return g.__cleanloopTm;
}

/** Same preprocessing as TM: centre square crop, resize, scale pixels to [-1, 1]. */
async function pixels(image: ImageInput, size: number): Promise<tf.Tensor4D> {
  const raw = await sharp(Buffer.from(image.data, "base64"))
    .rotate() // honour EXIF orientation from phone cameras
    .resize(size, size, { fit: "cover", position: "centre" })
    .removeAlpha()
    .raw()
    .toBuffer();
  return tf.tidy(() =>
    tf.tensor3d(new Uint8Array(raw), [size, size, 3], "int32").toFloat().div(127.5).sub(1).expandDims(0),
  ) as tf.Tensor4D;
}

/** Class name → probability for one photo. Exported for the evaluation script. */
export async function predict(image: ImageInput): Promise<Record<string, number>> {
  const { model, labels, size } = await ready();
  const input = await pixels(image, size);
  const probs = tf.tidy(() => (model.predict(input) as tf.Tensor).dataSync());
  input.dispose();
  return Object.fromEntries(labels.map((l, i) => [l, probs[i]]));
}

/**
 * How alike two photos' scenes are, region by region (-1..1). Waste removal changes the
 * ground; the road, walls and skyline around it stay, so a real before/after pair scores high
 * and a clean photo taken somewhere else scores low.
 */
export async function sceneMatch(a: ImageInput, b: ImageInput): Promise<number> {
  const [fa, fb] = await Promise.all([sceneFeatures(a), sceneFeatures(b)]);
  const cells = 49; // 7x7 grid
  const c = fa.length / cells;
  let total = 0;
  for (let p = 0; p < cells; p++) {
    let dot = 0, na = 0, nb = 0;
    for (let i = p * c; i < (p + 1) * c; i++) {
      dot += fa[i] * fb[i];
      na += fa[i] * fa[i];
      nb += fb[i] * fb[i];
    }
    total += dot / Math.sqrt(na * nb || 1);
  }
  return total / cells;
}

/** The scene's spatial feature map, flattened. Exported for calibration. */
export async function sceneFeatures(image: ImageInput): Promise<Float32Array> {
  const { scene, size } = await ready();
  const input = await pixels(image, size);
  const f = tf.tidy(() => (scene.predict(input) as tf.Tensor).dataSync() as Float32Array);
  input.dispose();
  return f;
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
      // "No waste in the photo" isn't enough: a photo of any clean field passes that.
      const match = await sceneMatch(before, after);
      if (match < SCENE_MATCH_THRESHOLD) {
        return {
          result: "ambiguous",
          confidence: clean,
          reasoning:
            "The photo looks clean, but it doesn't look like the same place as the report. Take it from where the before photo was taken.",
        };
      }
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
