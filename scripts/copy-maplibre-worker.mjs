/**
 * Copy MapLibre's worker bundle into public/ so Next can serve it.
 *
 * Importers/callers: none — run by the `predev` and `prebuild` npm hooks in package.json.
 * Affected API: none; writes two files into public/maplibre/.
 * Data schemas: none. Copies two .mjs files verbatim, no parsing.
 * User instruction, verbatim: "Fix the 3D map, no fallback plan"
 *
 * WHY THIS EXISTS
 * MapLibre v6 is ESM-only and loads its worker as a real URL
 * (`new Worker(new URL(...), {type:'module'})`). Turbopack does not emit that worker, so
 * the worker never spawns, tiles are never fetched, `isStyleLoaded()` never becomes true,
 * and the map renders blank — silently, with no console error (maplibre-gl-js#8024).
 * This is the documented Next.js workaround from the MapLibre ESM docs and issue #8126.
 *
 * BOTH FILES ARE REQUIRED: maplibre-gl-worker.mjs imports "./maplibre-gl-shared.mjs" by
 * relative path, so they must land in the same directory or the worker fails to load.
 *
 * Deliberately wired to predev/prebuild rather than postinstall: postinstall is skipped
 * when the install is a no-op and when --ignore-scripts is used, which would leave the
 * worker missing with no obvious cause.
 */

import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(projectRoot, "public", "maplibre");

// Resolve through the package rather than hardcoding node_modules, so this keeps
// working with hoisting, workspaces, or a different package manager layout.
let distDir;
try {
  distDir = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
} catch {
  console.error("[maplibre-worker] Could not resolve maplibre-gl. Is it installed?");
  process.exit(1);
}

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
  const src = join(distDir, file);
  if (!existsSync(src)) {
    console.error(
      `[maplibre-worker] Missing ${file} in ${distDir}. ` +
        `MapLibre's dist layout may have changed — check the version.`,
    );
    process.exit(1);
  }
  copyFileSync(src, join(outDir, file));
}

console.log(
  `[maplibre-worker] copied ${FILES.length} files -> public/maplibre/ ` +
    `(maplibre-gl ${require("maplibre-gl/package.json").version})`,
);
