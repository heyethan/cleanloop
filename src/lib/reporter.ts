/**
 * Is this request from the person who reported the case? Reporters are anonymous, so the only
 * proof is the private tracking code shown once after reporting (this device also keeps it in
 * localStorage, so the reporter never has to paste it).
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
  // The session id is NOT accepted as proof: it was stored on a publicly readable row, so
  // anyone could have read it. Only the private code (never stored, only its hash) counts.
  void sessionId;
  if (!code || !report.tracking_code_hash) return false;
  const a = Buffer.from(hashCode(code)), b = Buffer.from(report.tracking_code_hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
