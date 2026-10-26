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

function isSqliteCreateTrigger(prefix: string): boolean {
  let index = 0;
  const nextWord = (): string => {
    while (index < prefix.length) {
      if (/\s/.test(prefix[index]!)) {
        index += 1;
        continue;
      }
      if (prefix.startsWith("--", index)) {
        const newline = prefix.indexOf("\n", index + 2);
        index = newline < 0 ? prefix.length : newline + 1;
        continue;
      }
      if (prefix.startsWith("/*", index)) {
        const end = prefix.indexOf("*/", index + 2);
        if (end < 0) return "";
        index = end + 2;
        continue;
      }
      break;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(prefix.slice(index))?.[0];
    if (!word) return "";
    index += word.length;
    return word.toUpperCase();
  };
  if (nextWord() !== "CREATE") return false;
  let word = nextWord();
  if (word === "TEMP" || word === "TEMPORARY") word = nextWord();
  return word === "TRIGGER";
}

/** Split SQLite SQL at top-level semicolons, keeping trigger bodies intact. */
export function sqliteStatementRanges(
  sql: string,
  validate = true,
): { start: number; end: number }[] {
  const statements: { start: number; end: number }[] = [];
  let start = 0;
  let hasCode = false;
  let quote: "'" | '"' | "`" | "[" | null = null;
  let blockComment = false;
  let lineComment = false;
  let triggerBody = false;
  let inTrigger = false;
  let caseDepth = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      const closing = quote === "[" ? "]" : quote;
      if (char === closing) {
        if (quote !== "[" && next === closing) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      quote = char;
      hasCode = true;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (/[A-Za-z0-9_]/.test(sql[end] ?? "")) end += 1;
      const word = sql.slice(index, end).toUpperCase();
      if (
        !inTrigger &&
        word === "BEGIN" &&
        isSqliteCreateTrigger(sql.slice(start, end))
      ) {
        inTrigger = true;
        triggerBody = true;
      } else if (triggerBody && word === "CASE") {
        caseDepth += 1;
      } else if (triggerBody && word === "END") {
        if (caseDepth > 0) caseDepth -= 1;
        else triggerBody = false;
      }
      hasCode = true;
      index = end - 1;
      continue;
    }
    if (char === ";" && !triggerBody) {
      if (hasCode) statements.push({ start, end: index });
      start = index + 1;
      hasCode = false;
      inTrigger = false;
      caseDepth = 0;
      continue;
    }
    if (!/\s/.test(char)) hasCode = true;
  }
  if (validate && (quote !== null || blockComment))
    throw new Error(
      "Unterminated SQL string, identifier, or comment. No statements were executed.",
    );
  if (hasCode) statements.push({ start, end: sql.length });
  return statements;
}

export function splitSqliteStatements(sql: string): string[] {
  return sqliteStatementRanges(sql).map((range) =>
    sql.slice(range.start, range.end).trim(),
  );
}
