/**
 * Shared Overpass client — mirror rotation + retry.
 *
 * Importers/callers: scripts/seed.ts (waste facilities),
 * scripts/fetch-ward-boundaries.ts (locality boundary relations).
 * Affected API: exports OVERPASS_MIRRORS, UA, overpassQuery().
 * Data: takes an Overpass QL string, returns the parsed `elements` array. No file I/O,
 * no dates, no personal data.
 * User instruction, verbatim: "3. When in Map view, the specific locality like for
 * example: 'Kormangala' should be outlined when hovered over, so we get a visual grasp
 * of the area."
 *
 * Extracted from scripts/seed.ts rather than copied: the mirror list and the two-attempt
 * backoff were already proven against real 504s during seeding, and two divergent copies
 * of a retry policy is how one of them silently stops being the one that works.
 */

/**
 * Public Overpass instances rate-limit and 504 under load — the main one did
 * exactly that on first run. Try mirrors in turn rather than failing.
 */
export const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

/**
 * OSM infrastructure (like Wikimedia's) rejects generic agents. Identify the bot
 * and give a contact.
 */
export const UA = {
  "User-Agent":
    "CleanLoopHackathonBot/1.0 (https://github.com/cleanloop/cleanloop; civic waste demo) node-fetch",
};

/** Run an Overpass QL query, rotating mirrors until one answers. Throws if all fail. */
export async function overpassQuery<T = unknown>(ql: string): Promise<T[]> {
  let res: Response | null = null;

  for (const mirror of OVERPASS_MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(mirror, {
          method: "POST",
          headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: ql }),
          signal: AbortSignal.timeout(120_000),
        });
        if (r.ok) {
          res = r;
          console.log(`  overpass: ${new URL(mirror).host}`);
          break;
        }
        console.log(`  overpass ${new URL(mirror).host} -> ${r.status}, retrying`);
      } catch (e) {
        console.log(`  overpass ${new URL(mirror).host} -> ${(e as Error).name}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (res) break;
  }

  if (!res) throw new Error("all Overpass mirrors failed");
  const json = (await res.json()) as { elements: T[] };
  return json.elements;
}
