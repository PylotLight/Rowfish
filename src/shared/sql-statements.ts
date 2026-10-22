/** Split PostgreSQL SQL text at semicolons outside quoted strings, identifiers, and comments. */
export function postgresStatementRanges(
  sql: string,
  validate = true,
): { start: number; end: number }[] {
  const statements: { start: number; end: number }[] = [];
  let hasCode = false;
  let start = 0;
  let i = 0;
  let blockDepth = 0;
  let single = false;
  let double = false;
  let escapeString = false;
  let dollarTag: string | null = null;
  while (i < sql.length) {
    if (blockDepth > 0) {
      if (sql.startsWith("/*", i)) {
        blockDepth++;
        i += 2;
        continue;
      }
      if (sql.startsWith("*/", i)) {
        blockDepth--;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
      } else i++;
      continue;
    }
    const ch = sql[i]!;
    if (single) {
      if (escapeString && ch === "\\") {
        i += Math.min(2, sql.length - i);
        continue;
      }
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        single = false;
      }
      i++;
      continue;
    }
    if (double) {
      if (ch === '"') {
        if (sql[i + 1] === '"') {
          i += 2;
          continue;
        }
        double = false;
      }
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const newline = sql.indexOf("\n", i + 2);
      i = newline < 0 ? sql.length : newline + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      blockDepth = 1;
      i += 2;
      continue;
    }
    if (ch === '"') {
      hasCode = true;
      double = true;
      i++;
      continue;
    }
    if (ch === "'") {
      hasCode = true;
      // PostgreSQL E'...' enables backslash escapes; detect only a standalone E prefix.
      const prior = sql[i - 1];
      escapeString =
        (prior === "e" || prior === "E") &&
        (i < 2 || !/[\w$]/.test(sql[i - 2]!));
      single = true;
      i++;
      continue;
    }
    if (ch === "$" && (i === 0 || !/[\w$]/.test(sql[i - 1]!))) {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*|)\$/.exec(sql.slice(i));
      if (match) {
        hasCode = true;
        dollarTag = match[0];
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ";") {
      if (hasCode) statements.push({ start, end: i });
      start = i + 1;
      hasCode = false;
    }
    if (ch !== ";" && !/\s/.test(ch)) hasCode = true;
    i++;
  }
  if (validate && (single || double || dollarTag !== null || blockDepth > 0))
    throw new Error(
      "Unterminated SQL string, identifier, or comment. No statements were executed.",
    );
  if (hasCode) statements.push({ start, end: sql.length });
  return statements;
}

export function splitPostgresStatements(sql: string): string[] {
  return postgresStatementRanges(sql).map((range) =>
    sql.slice(range.start, range.end).trim(),
  );
}
