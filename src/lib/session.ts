/**
 * Anonymous session id — spec §5 `reporter_session_id`.
 *
 * Importers/callers: src/components/ReportSheet.tsx, src/components/ResolveSheet.tsx.
 * Affected API: exports getSessionId().
 * Data schemas: reads/writes one localStorage key ("cleanloop_session"), a uuid string.
 * No dates, no server-side file I/O.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * NOT authentication and not a defence against abuse — it is a stable-ish handle so the
 * app can flag self-resolution (§3 Flow B) and so rate-limiting has something to key on
 * later. A user can clear it trivially; §8 risk #4 documents this as a known limitation.
 */

const KEY = "cleanloop_session";

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
