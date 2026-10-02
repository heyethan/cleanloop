/**
 * Outbound email, sent at most once per dedupe key.
 *
 * Affected API: exports sendOnce(). Used by src/lib/notify.ts (new-case and digest emails).
 * Provider: AgentMail REST (POST /v0/inboxes/{MAIL_FROM}/messages/send), key AGENTMAIL_API_KEY.
 * email_log (schema-v3) is written FIRST: its unique dedupe_key makes a retry a no-op, and it is
 * the audit trail of everything CleanLoop sent. Real mail goes out only when MAIL_ENABLED=true AND
 * on the production deployment (VERCEL_ENV=production); otherwise it is printed, so local runs,
 * tests and the paused state can never email a real official.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  dedupeKey: string;
}

export async function sendOnce(db: SupabaseClient, mail: Mail): Promise<"sent" | "duplicate" | "printed"> {
  const { error } = await db
    .from("email_log")
    .insert({ dedupe_key: mail.dedupeKey, to_addr: mail.to, subject: mail.subject });
  if (error) {
    if (error.code === "23505") return "duplicate"; // unique_violation: already sent
    throw new Error(error.message);
  }

  const from = process.env.MAIL_FROM;
  const key = process.env.AGENTMAIL_API_KEY;
  // Kill switch: nothing is sent unless MAIL_ENABLED=true (Ethan turns this on when ready).
  if (process.env.MAIL_ENABLED !== "true" || process.env.VERCEL_ENV !== "production" || !from || !key) {
    console.log(`[mail:printed] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return "printed";
  }

  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(from)}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }),
  });
  const body = await res.json().catch(() => ({}));
  await db
    .from("email_log")
    .update(res.ok ? { provider_id: body.message_id ?? null } : { error: `HTTP ${res.status}` })
    .eq("dedupe_key", mail.dedupeKey);
  if (!res.ok) throw new Error(`mail send failed: HTTP ${res.status}`);
  return "sent";
}
