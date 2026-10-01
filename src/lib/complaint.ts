/**
 * The civic complaint text, from a fixed template.
 *
 * Affected API: exports complaintText(). Used by the stub and tm providers in ./ai.ts and
 * ./providers/tm.ts. Kept in its own file so tm.ts never imports a value from ai.ts — that
 * import was circular and threw "Cannot access 'tmProvider' before initialization".
 *
 * Plain prose on purpose: it is pasted into BBMP's complaint channel, so no markdown.
 */
import type { ComplaintInput } from "./types";

export function complaintText(input: ComplaintInput): string {
  const where = input.ward_name
    ? `${input.ward_name} (${input.lat.toFixed(5)}, ${input.lng.toFixed(5)})`
    : `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}`;
  const recurring = input.is_recurring
    ? " This location has been reported previously and the problem has recurred."
    : "";
  return (
    `An accumulation of ${input.waste_type} waste (severity ${input.severity} of 5) ` +
    `has been observed at ${where}.${recurring} ` +
    `Requesting inspection and clearance by the concerned ward office.`
  );
}
