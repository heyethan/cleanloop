/**
 * Signed, expiring links that let an official act on a case without an account.
 *
 * Affected API: exports Action, signAction(), verifyAction(). Used by the official email
 * (src/lib/notify.ts) and /api/act; checked in scripts/selfcheck.ts.
 * Token = base64url(JSON {r: reportId, a: action, x: expiry ms, n: nonce}) + "." + HMAC-SHA256.
 * Secret: ACTION_LINK_SECRET (Infisical / Vercel). Links act only on POST, so mail scanners that
 * prefetch the GET can't trigger anything; every action also lands on the public timeline.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type Action = "ack" | "assign" | "eta" | "resolve";
const ACTIONS: Action[] = ["ack", "assign", "eta", "resolve"];
const TTL_MS = 14 * 86_400_000;

const mac = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function signAction(reportId: string, action: Action, secret: string, now = Date.now()): string {
  const body = Buffer.from(
    JSON.stringify({ r: reportId, a: action, x: now + TTL_MS, n: randomBytes(6).toString("base64url") }),
  ).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function verifyAction(
  token: string,
  secret: string,
  now = Date.now(),
): { reportId: string; action: Action } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { r, a, x } = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof r !== "string" || !ACTIONS.includes(a) || typeof x !== "number" || now > x) return null;
    return { reportId: r, action: a };
  } catch {
    return null;
  }
}
