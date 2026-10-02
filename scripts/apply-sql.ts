/**
 * Run a SQL file against the live Supabase database.
 *
 *   npm run sql -- supabase/schema-v3.sql
 *
 * Affected API: CLI only, not imported. Needs SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD
 * (both in Infisical; `npm run sql` injects them) and the `supabase` CLI. Connects through the
 * session pooler with the database password, because the Management API token in Infisical had
 * expired. The schema files are idempotent, so running one twice is safe and is how a migration
 * is verified. The connection string is passed to the CLI, never printed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { splitSql } from "./sql-split.ts";

const file = process.argv[2];
const ref = process.env.SUPABASE_PROJECT_REF;
const password = process.env.SUPABASE_DB_PASSWORD;
const host = process.env.SUPABASE_POOLER_HOST ?? "aws-0-ap-south-1.pooler.supabase.com";
if (!file || !ref || !password) {
  console.error("usage: npm run sql -- <file.sql>  (needs SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD)");
  process.exit(1);
}

const url = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;
// The CLI accepts one statement per call, so run them in order and stop at the first failure.
const statements = splitSql(readFileSync(file, "utf8"));
const dir = mkdtempSync(path.join(tmpdir(), "sql-"));
try {
  statements.forEach((stmt, n) => {
    const one = path.join(dir, "stmt.sql");
    writeFileSync(one, stmt);
    try {
      const out = execFileSync("supabase", ["db", "query", "--db-url", url, "-f", one], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (n === statements.length - 1 && out.trim()) console.log(out.slice(0, 4000));
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      // Never echo the URL: scrub it and the password from the CLI's error text.
      const raw = `${err.stderr ?? ""}${err.stdout ?? ""}` || (e as Error).message;
      const msg = raw
        .replaceAll(url, "<db-url>")
        .replaceAll(encodeURIComponent(password), "***")
        .replaceAll(password, "***");
      console.error(`${file}: statement ${n + 1}/${statements.length} failed\n${stmt.slice(0, 300)}\n${msg.slice(0, 1500)}`);
      process.exit(1);
    }
  });
  console.log(`${file}: ok (${statements.length} statements)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
