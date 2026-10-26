import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

const outputDirectory = path.resolve("out/main");
const workerName = (await readdir(outputDirectory)).find(
  (name) => name.startsWith("database-worker-") && name.endsWith(".js"),
);
assert.ok(workerName, "built database worker exists");

const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "rowfish-sqlite-smoke-"),
);
const databaseFile = path.join(temporaryDirectory, "smoke.db");
const database = new DatabaseSync(databaseFile);
database.exec(`
  CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT);
  INSERT INTO items(label) VALUES ('alpha'), ('beta');
  CREATE TABLE alembic_version (version_num TEXT NOT NULL);
  INSERT INTO alembic_version VALUES ('head_a'), ('head_b');
`);
database.close();

const worker = new Worker(path.join(outputDirectory, workerName), {
  execArgv: [],
  workerData: {
    name: "SQLite worker smoke",
    kind: "sqlite",
    database: databaseFile,
    host: "",
    port: 0,
    username: "",
    password: "",
    tls: false,
    serverMode: false,
  },
});
const messages = [];
const waiters = [];
worker.on("message", (message) => {
  messages.push(message);
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    const waiter = waiters[index];
    if (!waiter.predicate(message)) continue;
    waiters.splice(index, 1);
    clearTimeout(waiter.timeout);
    waiter.resolve(message);
  }
});
worker.on("error", (error) => {
  for (const waiter of waiters.splice(0)) {
    clearTimeout(waiter.timeout);
    waiter.reject(error);
  }
});

function waitFor(predicate, description) {
  const existing = messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      reject,
      timeout: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${description}`));
      }, 5_000),
    };
    waiters.push(waiter);
  });
}

try {
  const startup = await waitFor(
    (message) => message.type === "ready" || message.type === "connect-error",
    "SQLite connection startup",
  );
  assert.equal(startup.type, "ready", startup.message);

  worker.postMessage({ type: "inspect-tables", requestId: "tables" });
  const tables = await waitFor(
    (message) =>
      (message.type === "inspection-result" ||
        message.type === "inspection-error") &&
      message.requestId === "tables",
    "SQLite table listing",
  );
  assert.equal(tables.type, "inspection-result", tables.message);
  assert.deepEqual(
    tables.tables.map((table) => table.name),
    ["alembic_version", "items"],
  );

  worker.postMessage({
    type: "inspect-postgres-columns",
    requestId: "columns",
  });
  const columns = await waitFor(
    (message) =>
      (message.type === "inspection-result" ||
        message.type === "inspection-error") &&
      message.requestId === "columns",
    "SQLite column listing",
  );
  assert.equal(columns.type, "inspection-result", columns.message);
  assert.ok(
    columns.postgresColumns.some(
      (column) => column.table === "items" && column.name === "label",
    ),
  );

  worker.postMessage({ type: "inspect-alembic-version", requestId: "alembic" });
  const alembic = await waitFor(
    (message) =>
      (message.type === "inspection-result" ||
        message.type === "inspection-error") &&
      message.requestId === "alembic",
    "Alembic current revisions",
  );
  assert.equal(alembic.type, "inspection-result", alembic.message);
  assert.deepEqual(alembic.alembicStatus.revisions, ["head_a", "head_b"]);

  worker.postMessage({
    type: "run",
    request: {
      queryId: "sqlite-smoke-query",
      query:
        "CREATE /* comment between keywords */ TRIGGER smoke_trigger AFTER INSERT ON items BEGIN INSERT INTO items(label) VALUES ('triggered'); END; SELECT id, label FROM items ORDER BY id; -- trailing comment only",
      maxRows: 100,
    },
  });
  const completion = await waitFor(
    (message) =>
      (message.type === "complete" || message.type === "error") &&
      message.queryId === "sqlite-smoke-query",
    "SQLite query completion",
  );
  assert.equal(completion.type, "complete", completion.message);
  const rows = messages
    .filter(
      (message) =>
        message.type === "rows" && message.queryId === "sqlite-smoke-query",
    )
    .flatMap((message) => message.rows);
  assert.equal(completion.receivedRows, 2);
  assert.deepEqual(rows, [
    { id: 1, label: "alpha" },
    { id: 2, label: "beta" },
  ]);

  worker.postMessage({ type: "close" });
  const closed = await waitFor(
    (message) => message.type === "closed",
    "SQLite worker close",
  );
  assert.equal(closed.type, "closed");
  console.log(
    "PASS SQLite worker connection, table/column inspection, multi-head Alembic rows, SQL query results, and clean close",
  );
} finally {
  await worker.terminate();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
