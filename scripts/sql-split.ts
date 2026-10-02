/**
 * Split a SQL file into single statements, because `supabase db query` runs one statement per
 * call ("cannot insert multiple commands into a prepared statement").
 *
 * Affected API: exports splitSql(). Used by scripts/apply-sql.ts; checked in scripts/selfcheck.ts.
 * Semicolons inside 'quotes', $tag$ bodies and -- comments don't split. Statements that are only
 * comments are dropped.
 * ponytail: no block-comment or E'' escape handling; the schema files use neither.
 */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      cur += sql.slice(i, stop);
      i = stop;
    } else if (c === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      cur += sql.slice(i, stop);
      i = stop;
    } else if (c === "$") {
      const tag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
      } else {
        cur += c;
        i++;
      }
    } else if (c === ";") {
      out.push(cur);
      cur = "";
      i++;
    } else {
      cur += c;
      i++;
    }
  }
  out.push(cur);
  return out
    .map((s) => s.trim())
    .filter((s) => s.split("\n").some((line) => line.trim() && !line.trim().startsWith("--")));
}
