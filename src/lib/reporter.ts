/**
 * Is this request from the person who reported the case? Reporters are anonymous, so proof is
 * either the same browser session or the private tracking code shown once after reporting.
 *
 * Affected API: exports hashCode(), isReporter(). Used by POST /api/reports/[id]/confirm and the
 * /r/[id] page; checked in scripts/selfcheck.ts. Only sha256(code) is ever stored.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

export function isReporter(
  report: { reporter_session_id: string | null; tracking_code_hash?: string | null },
  sessionId: string | null,
  code: string | null,
): boolean {
  if (sessionId && report.reporter_session_id && sessionId === report.reporter_session_id) return true;
  if (!code || !report.tracking_code_hash) return false;
  const a = Buffer.from(hashCode(code)), b = Buffer.from(report.tracking_code_hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
