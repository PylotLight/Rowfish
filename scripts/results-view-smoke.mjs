import { _electron as electron, expect } from "@playwright/test";
import { BSON } from "mongodb";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Compass-style result views (list / JSON / table) and resizable columns,
// against the real renderer with MongoDB IPC mocked in the main process.
const { EJSON, ObjectId, Int32 } = BSON;
const root = process.cwd();
const artifacts = join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), "rowfish-results-view-"));
const app = await electron.launch({
  executablePath: join(root, "node_modules/electron/dist/electron"),
  args: ["--no-sandbox", `--user-data-dir=${userData}`, "out/main/index.js"],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ":107" },
});
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
const errors = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = async (name, run) => {
  await run();
  checks.push(name);
  console.log("PASS", name);
};

/** Builds a result the way the worker does: flat cells + canonical EJSON. */
function result(count) {
  const columns = ["_id", "name", "age", "tags", "address", "created"];
  const rows = [];
  const documents = [];
  for (let index = 0; index < count; index += 1) {
    const document = {
      _id: new ObjectId(
        `65a1f0c2e4b0a1b2c3d4${index.toString(16).padStart(4, "0")}`,
      ),
      name: `Customer ${index}`,
      age: new Int32(20 + (index % 50)),
      tags: ["vip", `t${index % 7}`],
      address: { city: "Melbourne", zip: `${3000 + index}`, geo: { lat: 1 } },
      created: new Date(Date.UTC(2024, 0, 1 + (index % 28))),
    };
    rows.push({
      _id: document._id.toHexString(),
      name: document.name,
      age: document.age.value,
      tags: JSON.stringify(document.tags),
      address: JSON.stringify(document.address),
      created: document.created.toISOString(),
    });
    documents.push(EJSON.stringify(document, { relaxed: false }));
  }
  return { columns, rows, documents };
}
const results = { many: result(300), one: result(1) };

await app.evaluate(({ ipcMain, BrowserWindow }, results) => {
  const state = { next: "many" };
  for (const channel of [
    "database:saved",
    "database:connect-saved",
    "database:run",
    "database:mongo-databases",
    "database:mongo-collections",
  ])
    ipcMain.removeHandler(channel);
  const saved = {
    id: "saved-mongo",
    name: "Saved MongoDB",
    kind: "mongodb",
    host: "db.example.test",
    port: 27017,
    database: "appdb",
    username: "tester",
  };
  ipcMain.handle("database:saved", () => [saved]);
  ipcMain.handle("database:connect-saved", () => ({
    ...saved,
    id: "live-mongo",
    connected: true,
    savedConnectionId: "saved-mongo",
  }));
  ipcMain.handle("database:mongo-databases", () => [{ name: "appdb" }]);
  ipcMain.handle("database:mongo-collections", () => []);
  ipcMain.handle("database:run", (_event, request) => {
    const { columns, rows, documents } = results[state.next];
    setTimeout(() => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send("database:event", {
        type: "query:rows",
        queryId: request.queryId,
        columns,
        rows,
        documents,
        receivedRows: rows.length,
      });
      win?.webContents.send("database:event", {
        type: "query:complete",
        queryId: request.queryId,
        receivedRows: rows.length,
        elapsedMs: 1,
        truncated: false,
      });
    }, 30);
    return { queryId: request.queryId };
  });
  globalThis.__resultsSmoke = state;
}, results);

await page.addInitScript(() => {
  if (sessionStorage.getItem("results-smoke-seeded")) return;
  sessionStorage.setItem("results-smoke-seeded", "1");
  localStorage.setItem("rowfish.sidebar-hidden", "true");
  localStorage.setItem(
    "rowfish.query-workspace.v1",
    JSON.stringify({
      tabs: [
        {
          id: "mongo-tab",
          title: "Customers",
          query: "{}",
          kind: "mongodb",
          connectionKey: "offline",
          updatedAt: Date.now(),
        },
      ],
      activeTabId: "mongo-tab",
      saved: [],
      history: [],
    }),
  );
});
const runButton = () => page.getByRole("button", { name: /Run query/i });
const summary = () => page.locator(".db-results-summary");
const runQuery = async (which, expected) => {
  await app.evaluate((_electron, which) => {
    globalThis.__resultsSmoke.next = which;
  }, which);
  await runButton().click();
  await expect(summary()).toContainText(expected, { timeout: 15000 });
};

try {
  await page.reload();
  await page.waitForSelector(".cm-content");
  await check("mongo results default to a typed table", async () => {
    await runButton().click();
    await page
      .getByRole("dialog", { name: "Choose a query connection" })
      .getByRole("button", { name: "Reconnect Saved MongoDB" })
      .click();
    await expect(summary()).toContainText("MongoDB", { timeout: 15000 });
    await runQuery("many", "300 rows");
    await expect(
      page.getByRole("button", { name: "Table view" }),
    ).toHaveAttribute("aria-pressed", "true");
    const head = page.locator(".db-result-table thead");
    await expect(head).toContainText("ObjectId");
    await expect(head).toContainText("Int32");
    await expect(head).toContainText("Object");
    await expect(head).toContainText("Date");
    await expect(page.locator(".db-result-table tbody")).toContainText(
      "{} 3 fields",
    );
    await expect(page.locator(".db-result-table tbody")).toContainText(
      "[] 2 items",
    );
    await page.screenshot({ path: join(artifacts, "rowfish-table-view.png") });
  });

  await check("column edges resize, persist and auto-fit", async () => {
    const header = page.locator(".db-result-table th").filter({
      hasText: /^name/,
    });
    const before = (await header.boundingBox()).width;
    const handle = page.getByRole("separator", { name: "Resize name" });
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => (await header.boundingBox()).width)
      .toBeGreaterThan(before + 80);
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rowfish.column-widths.v1") || "{}"),
    );
    expect(Object.keys(stored.widths ?? {})).toHaveLength(1);
    await handle.dblclick();
    await expect
      .poll(async () => (await header.boundingBox()).width)
      .toBeLessThan(before + 80);
  });

  await check("list view renders document cards lazily", async () => {
    await page.getByRole("button", { name: "List view" }).click();
    const cards = page.locator(".db-doc-card");
    await expect(cards.first()).toContainText(
      "ObjectId('65a1f0c2e4b0a1b2c3d40000')",
    );
    await expect(cards.first()).toContainText('"Customer 0"');
    await expect(cards.first()).toContainText("Object (3)");
    await expect(cards.first()).toContainText("Array (2)");
    expect(await cards.count()).toBeLessThan(300);
    await cards.first().getByRole("button", { name: "Expand address" }).click();
    await expect(cards.first()).toContainText('"Melbourne"');
    await expect(cards.first()).not.toContainText("lat");
    await cards.first().hover();
    await cards
      .first()
      .getByRole("button", { name: "Collapse all fields" })
      .click();
    await expect(cards.first()).not.toContainText('"Melbourne"');
    await cards
      .first()
      .getByRole("button", { name: "Expand all fields" })
      .click();
    await expect(cards.first()).toContainText("lat");
    expect(
      await page.evaluate(() => localStorage.getItem("rowfish.results-view")),
    ).toBe("list");
    await page.screenshot({ path: join(artifacts, "rowfish-list-view.png") });
  });

  await check("document actions open prefilled operations", async () => {
    const card = page.locator(".db-doc-card").first();
    await card.hover();
    await card.getByRole("button", { name: "Edit document" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("65a1f0c2e4b0a1b2c3d40000", {
      useInnerText: false,
    });
    await page.screenshot({ path: join(artifacts, "rowfish-edit-doc.png") });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  await check("JSON view shows relaxed EJSON", async () => {
    await page.getByRole("button", { name: "JSON view" }).click();
    const first = page.locator(".db-doc-json").first();
    await expect(first).toContainText('"$oid": "65a1f0c2e4b0a1b2c3d40000"');
    await expect(first).toContainText('"$date": "2024-01-01T00:00:00.000Z"');
    await expect(first).toContainText('"age": 20');
    await page.screenshot({ path: join(artifacts, "rowfish-json-view.png") });
  });

  await check("a single document opens as a list by default", async () => {
    await page.evaluate(() => localStorage.removeItem("rowfish.results-view"));
    await page.getByRole("button", { name: "Table view" }).click();
    await page.evaluate(() => localStorage.removeItem("rowfish.results-view"));
    await page.reload();
    await page.waitForSelector(".cm-content");
    await runButton().click();
    const chooser = page.getByRole("dialog", {
      name: "Choose a query connection",
    });
    await chooser
      .getByRole("button", { name: "Reconnect Saved MongoDB" })
      .click();
    await expect(summary()).toContainText("MongoDB", { timeout: 15000 });
    await runQuery("one", "1 rows");
    await expect(
      page.getByRole("button", { name: "List view" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".db-doc-card")).toHaveCount(1);
  });

  expect(errors).toEqual([]);
  await writeFile(
    join(artifacts, "smoke-results-view.json"),
    JSON.stringify({ checks }, null, 2) + "\n",
  );
  console.log("ALL CHECKS PASSED");
} catch (error) {
  await page
    .screenshot({ path: join(artifacts, "smoke-results-view-failure.png") })
    .catch(() => {});
  console.error(
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  throw error;
} finally {
  await app.close();
}
