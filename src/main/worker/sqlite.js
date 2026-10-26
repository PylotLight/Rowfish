import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DATABASE_LIMITS } from "../../shared/database-helpers";
import {
  config,
  state,
  post,
  buildRow,
  distinctColumnNames,
  postBatch,
} from "./shared";

const BATCH_SIZE = DATABASE_LIMITS.batchSize;
const MAX_COLUMNS = DATABASE_LIMITS.maxColumns;
const MAX_RESULT_BYTES = DATABASE_LIMITS.maxResultBytes;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function openSqliteDatabase() {
  const file = config.database;
  const info = statSync(file);
  if (!info.isFile()) throw new Error("Choose a SQLite database file.");
  state.sqlite = new DatabaseSync(file);
  state.sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
}

export function closeSqliteDatabase() {
  if (!state.sqlite) return;
  state.sqlite.close();
  state.sqlite = null;
}

export function probeSqliteDatabase() {
  openSqliteDatabase();
  const startedAt = performance.now();
  const row = state.sqlite.prepare("SELECT sqlite_version() AS version").get();
  const elapsedMs = Math.round(performance.now() - startedAt);
  closeSqliteDatabase();
  post({
    type: "probe-result",
    elapsedMs,
    serverVersion: `SQLite ${row?.version ?? "unknown"}`,
  });
}

export function listSqliteTables() {
  if (!state.sqlite) throw new Error("SQLite connection is unavailable.");
  return state.sqlite
    .prepare(
      "SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((item) => ({
      schema: "main",
      name: String(item.name),
      kind: item.type === "view" ? "view" : "table",
    }));
}

export function listSqliteColumns() {
  if (!state.sqlite) throw new Error("SQLite connection is unavailable.");
  return listSqliteTables().flatMap((table) =>
    state.sqlite
      .prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`)
      .all()
      .map((column) => ({
        schema: table.schema,
        table: table.name,
        name: String(column.name),
      })),
  );
}

export function readSqliteAlembicVersion() {
  if (!state.sqlite) throw new Error("SQLite connection is unavailable.");
  const found = state.sqlite
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get("alembic_version");
  if (!found) return { tableFound: false, revisions: [] };
  const columns = state.sqlite
    .prepare(`PRAGMA table_info(${quoteIdentifier("alembic_version")})`)
    .all();
  if (!columns.some((column) => column.name === "version_num"))
    return {
      tableFound: true,
      revisions: [],
      error: "The alembic_version table has no version_num column.",
    };
  const revisions = state.sqlite
    .prepare("SELECT version_num FROM alembic_version ORDER BY version_num")
    .all()
    .map((row) => String(row.version_num));
  return { tableFound: true, revisions };
}

function isSqliteCreateTrigger(prefix) {
  let index = 0;
  const nextWord = () => {
    while (index < prefix.length) {
      if (/\s/.test(prefix[index])) {
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

function splitSqliteStatements(sql) {
  const statements = [];
  let start = 0;
  let hasCode = false;
  let quote = "";
  let blockComment = false;
  let lineComment = false;
  let trigger = false;
  let triggerBody = false;
  let caseDepth = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
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
        if (sql[index + 1] === closing && quote !== "[") index += 1;
        else quote = "";
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
        !trigger &&
        word === "BEGIN" &&
        isSqliteCreateTrigger(sql.slice(start, end))
      ) {
        trigger = true;
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
      const statement = sql.slice(start, index).trim();
      if (hasCode && statement) statements.push(statement);
      start = index + 1;
      trigger = false;
      caseDepth = 0;
      hasCode = false;
      continue;
    }
    if (!/\s/.test(char)) hasCode = true;
  }
  if (quote || blockComment)
    throw new Error(
      "Unterminated SQL string, identifier, or comment. No statements were executed.",
    );
  const tail = sql.slice(start).trim();
  if (hasCode && tail) statements.push(tail);
  return statements;
}

export function readSqlite(request) {
  if (!state.sqlite) throw new Error("SQLite connection is unavailable.");
  const statements = splitSqliteStatements(request.query);
  if (statements.length === 0) throw new Error("Enter a SQL statement to run.");
  const startedAt = Date.now();
  let receivedRows = 0;
  let estimatedBytes = 0;
  let truncated = false;
  let affectedRows = 0;
  let hasAffectedRows = false;
  const finalIndex = statements.length - 1;
  for (
    let statementIndex = 0;
    statementIndex < statements.length;
    statementIndex += 1
  ) {
    const statement = state.sqlite.prepare(statements[statementIndex]);
    const columns = statement.columns();
    const isFinal = statementIndex === finalIndex;
    if (columns.length === 0) {
      const result = statement.run();
      if (isFinal || result.changes > 0) {
        affectedRows += Number(result.changes);
        hasAffectedRows = true;
      }
      continue;
    }
    statement.setReturnArrays(true);
    const names = distinctColumnNames(
      columns.map((column) => column.name).slice(0, MAX_COLUMNS),
    );
    const columnSet = new Set(names);
    let outgoing = [];
    let statementRows = 0;
    const iterator = statement.iterate();
    for (const values of iterator) {
      statementRows += 1;
      if (!isFinal) continue;
      if (receivedRows >= request.maxRows) {
        truncated = true;
        iterator.return?.();
        break;
      }
      const row = buildRow(names, values.slice(0, MAX_COLUMNS));
      const rowBytes = Buffer.byteLength(JSON.stringify(row));
      if (estimatedBytes + rowBytes > MAX_RESULT_BYTES) {
        truncated = true;
        iterator.return?.();
        break;
      }
      estimatedBytes += rowBytes;
      receivedRows += 1;
      outgoing.push(row);
      if (outgoing.length >= BATCH_SIZE) {
        postBatch(request.queryId, outgoing, columnSet, receivedRows);
        outgoing = [];
      }
    }
    if (isFinal) {
      post({
        type: "rows",
        queryId: request.queryId,
        rows: outgoing,
        columns: names,
        receivedRows,
      });
    }
    if (truncated) break;
    if (!isFinal) continue;
    if (statementRows > request.maxRows) truncated = true;
  }
  post({
    type: "complete",
    queryId: request.queryId,
    receivedRows,
    elapsedMs: Date.now() - startedAt,
    truncated,
    ...(hasAffectedRows ? { affectedRows } : {}),
    statementCount: statements.length,
  });
}
