import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Real renderer/preload/UI with database IPC mocked durably in the main process.
const root = process.cwd();
const artifacts = join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), "rowfish-query-connection-"));
const app = await electron.launch({
  executablePath: join(root, "node_modules/electron/dist/electron"),
  args: ["--no-sandbox", `--user-data-dir=${userData}`, "out/main/index.js"],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ":106" },
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
const editor = () => page.locator(".cm-content");
const run = () => page.getByRole("button", { name: /Run query/i });
const dialog = () =>
  page.getByRole("dialog", { name: "Choose a query connection" });
const profile = (id, name, kind = "postgres") => ({
  id,
  name,
  kind,
  host: "db.example.test",
  port: kind === "postgres" ? 5432 : 27017,
  database: "appdb",
  username: "tester",
  saved: true,
});
const online = (
  id,
  name,
  kind = "postgres",
  database = "appdb",
  extra = {},
) => ({
  id,
  name,
  kind,
  host: "db.example.test",
  port: kind === "postgres" ? 5432 : 27017,
  database,
  username: "tester",
  connected: true,
  ...extra,
});
const queryTab = (
  kind = "postgres",
  query = "SELECT 731 AS preserved_draft;",
) => ({
  id: "offline-query-tab",
  title: "Offline draft — keep this title",
  query,
  kind,
  connectionKey: "offline-connection",
  updatedAt: Date.now(),
});
const workspace = (kind = "postgres", query) => ({
  tabs: [queryTab(kind, query)],
  activeTabId: "offline-query-tab",
  saved: [],
  history: [],
});
const profiles = [
  profile("saved-pg", "Saved PostgreSQL"),
  profile("saved-mongo", "Saved MongoDB", "mongodb"),
];

// Install handlers in Electron's main process, where ipcMain handlers are mutable.
await app.evaluate(({ ipcMain, BrowserWindow }) => {
  const state = { calls: [], failure: null, connections: [] };
  const ch = [
    "database:list-tables",
    "database:postgres-columns",
    "database:postgres-server-info",
    "database:saved",
    "database:connect-saved",
    "database:connect",
    "database:run",
    "database:list-databases",
    "database:open-database",
    "database:switch-database",
    "database:mongo-databases",
    "database:mongo-collections",
  ];
  for (const channel of ch) ipcMain.removeHandler(channel);
  ipcMain.handle("database:list-tables", () => []);
  ipcMain.handle("database:postgres-columns", () => []);
  ipcMain.handle("database:postgres-server-info", () => ({
    database: "appdb",
    user: "tester",
    version: "fixture",
  }));
  ipcMain.handle("database:saved", () => [
    {
      id: "saved-pg",
      name: "Saved PostgreSQL",
      kind: "postgres",
      host: "db.example.test",
      port: 5432,
      database: "appdb",
      username: "tester",
    },
    {
      id: "saved-mongo",
      name: "Saved MongoDB",
      kind: "mongodb",
      host: "db.example.test",
      port: 27017,
      database: "appdb",
      username: "tester",
    },
  ]);
  ipcMain.handle("database:connect-saved", (_event, id) => {
    state.calls.push(["connectSaved", id]);
    if (state.failure) throw new Error(state.failure);
    const p =
      id === "saved-mongo"
        ? { id: "live-mongo", name: "Saved MongoDB", kind: "mongodb" }
        : { id: "live-pg", name: "Saved PostgreSQL", kind: "postgres" };
    const value = {
      ...p,
      host: "db.example.test",
      port: p.kind === "postgres" ? 5432 : 27017,
      database: "appdb",
      username: "tester",
      connected: true,
      savedConnectionId: id,
    };
    state.connections.push(value);
    return value;
  });
  ipcMain.handle("database:connect", (_event, input, save) => {
    state.calls.push(["connect", input, save]);
    const value = { ...input, id: "live-new", connected: true };
    state.connections.push(value);
    return value;
  });
  ipcMain.handle("database:list-databases", (_event, id) => {
    state.calls.push(["listDatabases", id]);
    return [
      { name: "appdb", canConnect: true },
      { name: "otherdb", canConnect: true },
    ];
  });
  ipcMain.handle("database:open-database", (_event, id, database) => {
    state.calls.push(["openDatabase", id, database]);
    const parent = state.connections.find((x) => x.id === id) || {
      name: "Server",
      kind: "postgres",
      host: "db.example.test",
      port: 5432,
      username: "tester",
    };
    const child = {
      ...parent,
      id: "live-child",
      name: `${parent.name} — ${database}`,
      database,
      connected: true,
      serverMode: false,
      parentConnectionId: id,
    };
    state.connections.push(child);
    return child;
  });
  ipcMain.handle("database:switch-database", (_event, id, database) => {
    state.calls.push(["switchDatabase", id, database]);
    const current = state.connections.find((x) => x.id === id);
    const value = { ...current, id: `${id}-${database}`, database };
    state.connections.push(value);
    return value;
  });
  ipcMain.handle("database:mongo-databases", () => [{ name: "appdb" }]);
  ipcMain.handle("database:mongo-collections", () => []);
  ipcMain.handle("database:run", (_event, request) => {
    state.calls.push(["run", request]);
    setTimeout(() => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send("database:event", {
        type: "query:rows",
        queryId: request.queryId,
        columns: ["value"],
        rows: [{ value: 731 }],
        receivedRows: 1,
      });
      win?.webContents.send("database:event", {
        type: "query:complete",
        queryId: request.queryId,
        receivedRows: 1,
        elapsedMs: 1,
        truncated: false,
      });
    }, 30);
    return { queryId: request.queryId };
  });
  globalThis.__querySmokeState = state;
});
await page.addInitScript(() => {
  const seed = sessionStorage.getItem("query-smoke-seed");
  if (seed) localStorage.setItem("rowfish.query-workspace.v1", seed);
  localStorage.setItem("rowfish.sidebar-hidden", "true");
});
const fixture = async (kind = "postgres", extra = {}) => {
  const state = {
    ...workspace(
      kind,
      kind === "mongodb" ? '{"preserved_draft":731}' : undefined,
    ),
    ...extra,
  };
  await page.evaluate(
    (state) =>
      sessionStorage.setItem("query-smoke-seed", JSON.stringify(state)),
    state,
  );
  await app.evaluate(() => {
    globalThis.__querySmokeState.calls.length = 0;
    globalThis.__querySmokeState.failure = null;
  });
  await page.reload();
  await page.waitForSelector(".cm-content");
  await expect(editor()).toContainText("preserved_draft");
};
const calls = async () =>
  app.evaluate(() => globalThis.__querySmokeState.calls);
const clearCalls = async () =>
  app.evaluate(() => {
    globalThis.__querySmokeState.calls.length = 0;
    globalThis.__querySmokeState.failure = null;
  });
try {
  await page.waitForSelector(".cm-content");
  await fixture();
  await check(
    "restored offline draft is runnable, retains tab/title, and prompts without autorun",
    async () => {
      await expect(run()).toBeEnabled();
      await run().click();
      await expect(dialog()).toBeVisible();
      await expect(
        dialog().getByRole("button", { name: "Reconnect Saved PostgreSQL" }),
      ).toBeVisible();
      await expect(
        dialog().getByRole("button", { name: "New connection" }),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: /Offline draft — keep this title/ }),
      ).toBeVisible();
      expect((await calls()).filter((x) => x[0] === "run")).toHaveLength(0);
    },
  );
  await check(
    "Escape and F5 cancel picker; cancellation does not execute",
    async () => {
      await page.keyboard.press("Escape");
      await expect(dialog()).toHaveCount(0);
      await page.evaluate(() =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "F5",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      await expect(dialog()).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog()).toHaveCount(0);
      await editor().click();
      await page.keyboard.press("Control+Enter");
      await expect(dialog()).toBeVisible();
      await page.keyboard.press("Escape");
      expect((await calls()).filter((x) => x[0] === "run")).toHaveLength(0);
    },
  );
  await check(
    "saved reconnect failure is retryable and successful retry preserves draft and never autoruns",
    async () => {
      await run().click();
      await app.evaluate(() => {
        globalThis.__querySmokeState.failure = "mock reconnect failure";
      });
      await dialog()
        .getByRole("button", { name: "Reconnect Saved PostgreSQL" })
        .click();
      await expect(dialog().getByRole("alert")).toContainText(
        "mock reconnect failure",
      );
      await expect(
        dialog().getByRole("button", { name: "Reconnect Saved PostgreSQL" }),
      ).toBeEnabled();
      await app.evaluate(() => {
        globalThis.__querySmokeState.failure = null;
      });
      await dialog()
        .getByRole("button", { name: "Reconnect Saved PostgreSQL" })
        .click();
      await expect(dialog()).toHaveCount(0);
      await expect(page.getByRole("status")).toContainText(
        "Query connected. Review the selected database, then run when ready.",
      );
      await expect(editor()).toContainText("preserved_draft");
      await expect(
        page.getByRole("tab", { name: /Offline draft — keep this title/ }),
      ).toHaveCount(1);
      expect((await calls()).filter((x) => x[0] === "run")).toHaveLength(0);
    },
  );
  await check(
    "explicit Run invokes mocked query and receives completion",
    async () => {
      await clearCalls();
      await run().click();
      await expect
        .poll(async () => (await calls()).filter((x) => x[0] === "run").length)
        .toBe(1);
      await expect(page.locator(".db-results-summary")).toContainText(/1 row/);
      expect((await calls()).find((x) => x[0] === "run")[1].query).toContain(
        "preserved_draft",
      );
    },
  );
  await check(
    "kind filtering works for offline Mongo labels and compatible reconnect retains Mongo kind",
    async () => {
      await fixture("mongodb");
      await run().click();
      await expect(
        dialog().getByRole("button", { name: "Reconnect Saved MongoDB" }),
      ).toBeVisible();
      await expect(
        dialog().getByRole("button", { name: "Reconnect Saved PostgreSQL" }),
      ).toHaveCount(0);
      await dialog()
        .getByRole("button", { name: "Reconnect Saved MongoDB" })
        .click();
      const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("rowfish.query-workspace.v1")),
      );
      expect(stored.tabs.find((t) => t.id === "offline-query-tab").kind).toBe(
        "mongodb",
      );
      await expect(
        page.getByRole("tab", { name: /Offline draft — keep this title/ }),
      ).toHaveCount(1);
    },
  );
  await check(
    "saved-library draft opens offline preserving kind and connection key",
    async () => {
      await fixture("mongodb", {
        saved: [
          {
            id: "saved-mongo-query",
            title: "Saved offline Mongo",
            query: "{}",
            kind: "mongodb",
            connectionKey: "saved-key",
            folder: "General",
            updatedAt: Date.now(),
          },
        ],
      });
      await page.locator(".sidebar-toggle").click();
      await page.getByRole("tab", { name: "Queries", exact: true }).click();
      await page.locator(".library-item > button").first().click();
      await expect(
        page.getByRole("tab", { name: /Saved offline Mongo/ }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() =>
            JSON.parse(
              localStorage.getItem("rowfish.query-workspace.v1"),
            ).tabs.some((t) => t.title === "Saved offline Mongo"),
          ),
        )
        .toBe(true);
      const s = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("rowfish.query-workspace.v1")),
      );
      const tab = s.tabs.find((t) => t.title.includes("Saved offline Mongo"));
      expect(tab.kind).toBe("mongodb");
      expect(tab.connectionKey).toBe("saved-key");
    },
  );
  await check(
    "live connection mismatch opens chooser rather than running",
    async () => {
      await fixture("postgres", {
        saved: [
          {
            id: "other-query",
            title: "Different database query",
            query: "SELECT 5;",
            kind: "postgres",
            connectionKey: "different-database",
            folder: "General",
            updatedAt: Date.now(),
          },
        ],
      });
      await run().click();
      await dialog()
        .getByRole("button", { name: "Reconnect Saved PostgreSQL" })
        .click();
      await page.locator(".sidebar-toggle").click();
      await page.getByRole("tab", { name: "Queries", exact: true }).click();
      await page.locator(".library-item > button").first().click();
      await expect(editor()).toHaveText("SELECT 5;");
      await run().click();
      await expect(dialog()).toBeVisible();
      await expect(
        dialog().getByRole("button", {
          name: "Use Saved PostgreSQL",
          exact: true,
        }),
      ).toBeVisible();
      expect((await calls()).filter((x) => x[0] === "run")).toHaveLength(0);
      await dialog()
        .getByRole("button", { name: "Use Saved PostgreSQL", exact: true })
        .click();
      await expect(dialog()).toHaveCount(0);
      await expect(
        page.getByRole("tab", { name: /Different database query/ }),
      ).toHaveAttribute("aria-selected", "true");
      expect((await calls()).filter((x) => x[0] === "run")).toHaveLength(0);
    },
  );
  await check(
    "new connection binds the same draft without autorunning",
    async () => {
      await fixture();
      await run().click();
      await dialog().getByRole("button", { name: "New connection" }).click();
      const connect = page.getByRole("dialog", { name: "Connect a database" });
      await expect(connect).toBeVisible();
      await connect.getByRole("radio", { name: "Manual", exact: true }).click();
      await connect
        .getByLabel("Connection name", { exact: true })
        .fill("Mock new connection");
      await connect.getByLabel("Host", { exact: true }).fill("db.example.test");
      await connect.getByLabel("Database", { exact: true }).fill("appdb");
      await connect.getByLabel(/^Username/).fill("tester");
      await connect.getByRole("button", { name: /^Connect$/ }).click();
      await expect(connect).toHaveCount(0);
      await expect(
        page.getByRole("tab", { name: /Offline draft — keep this title/ }),
      ).toHaveCount(1);
      expect((await calls()).filter((x) => x[0] === "run")).toHaveLength(0);
    },
  );
  await check(
    "PostgreSQL server profile lists child databases and binds selected child to draft",
    async () => {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("database:connect-saved");
        ipcMain.handle("database:connect-saved", (_event, id) => {
          globalThis.__querySmokeState.calls.push(["connectSaved", id]);
          const value = {
            id: "server-profile",
            name: "Server profile",
            kind: "postgres",
            host: "db.example.test",
            port: 5432,
            database: "",
            username: "tester",
            connected: true,
            serverMode: true,
            savedConnectionId: id,
          };
          globalThis.__querySmokeState.connections.push(value);
          return value;
        });
      });
      await fixture();
      await run().click();
      await dialog()
        .getByRole("button", { name: "Reconnect Saved PostgreSQL" })
        .click();
      await expect(
        dialog().getByRole("button", { name: "Use database appdb" }),
      ).toBeVisible();
      await dialog()
        .getByRole("button", { name: "Use database appdb" })
        .click();
      await expect(dialog()).toHaveCount(0);
      expect(
        (await calls()).some(
          (x) => x[0] === "openDatabase" && x[2] === "appdb",
        ),
      ).toBe(true);
      expect((await calls()).filter((x) => x[0] === "run")).toHaveLength(0);
    },
  );
  await check("Test & Save failure offers Save anyway", async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("database:connect");
      ipcMain.handle("database:connect", (_event, input, save) => {
        globalThis.__querySmokeState.calls.push(["connect", input, save]);
        throw new Error("connect ECONNREFUSED 10.0.0.9:6543");
      });
      ipcMain.removeHandler("database:test-connection");
      ipcMain.handle("database:test-connection", (_event, input) => {
        globalThis.__querySmokeState.calls.push(["testConnection", input]);
        throw new Error("connect ECONNREFUSED 10.0.0.9:6543");
      });
      ipcMain.removeHandler("database:save-connection");
      ipcMain.handle("database:save-connection", (_event, input) => {
        globalThis.__querySmokeState.calls.push(["saveConnection", input]);
        return { ...input, id: "saved-anyway", hasSecret: true };
      });
    });
    await fixture();
    await run().click();
    await dialog().getByRole("button", { name: "New connection" }).click();
    const connect = page.getByRole("dialog", { name: "Connect a database" });
    await connect.getByRole("radio", { name: "Manual", exact: true }).click();
    await connect
      .getByLabel("Connection name", { exact: true })
      .fill("Offline warehouse");
    await connect.getByLabel("Host", { exact: true }).fill("10.0.0.9");
    await connect.getByLabel("Port", { exact: true }).fill("6543");
    await connect.getByLabel("Database", { exact: true }).fill("warehouse");
    await connect.getByLabel(/^Username/).fill("analyst");
    await connect.getByLabel(/^Password/).fill("p@ss");
    await expect(connect.locator(".db-uri-preview")).toHaveText(
      "postgresql://analyst:••••••@10.0.0.9:6543/warehouse",
    );
    await connect
      .getByRole("radio", { name: "Connection string", exact: true })
      .click();
    const uri = connect.getByLabel("Connection string", { exact: true });
    await expect(connect.getByTestId("detected-kind")).toHaveText(
      "Detected: PostgreSQL",
    );
    await expect(uri).toHaveValue(
      "postgresql://analyst:p%40ss@10.0.0.9:6543/warehouse",
    );
    await uri.fill("postgres://broken:6543x/warehouse");
    await expect(connect.locator(".db-uri-hint.error")).toContainText("port");
    const target =
      "postgresql://analyst:p%40ss@10.0.0.9:6543/warehouse?sslmode=require&application_name=smoke";
    await uri.fill(target);
    await expect(connect.locator(".db-uri-hint")).toContainText(
      "10.0.0.9:6543/warehouse as analyst · sslmode require",
    );
    await expect(connect.locator(".db-uri-hint")).toContainText(
      "application_name",
    );
    await connect.getByRole("button", { name: /^Connect$/ }).click();
    await expect(connect.getByRole("alert")).toContainText("ECONNREFUSED");
    // A failed Connect no longer offers Save anyway; the footer's
    // Save without testing covers that.
    await expect(
      connect.getByRole("button", { name: "Save anyway" }),
    ).toHaveCount(0);
    await connect.getByRole("button", { name: "Test & Save" }).click();
    await expect(connect.getByRole("alert").first()).toContainText(
      "Test failed: connect ECONNREFUSED",
    );
    expect(
      (await calls()).filter((x) => x[0] === "saveConnection"),
    ).toHaveLength(0);
    await connect.getByRole("button", { name: "Save anyway" }).click();
    await expect(connect).toHaveCount(0);
    expect(
      (await calls()).filter((x) => x[0] === "testConnection"),
    ).toHaveLength(1);
    const saved = (await calls()).find((x) => x[0] === "saveConnection");
    expect(saved?.[1]).toMatchObject({
      name: "Offline warehouse",
      kind: "postgres",
      connectionString: target,
    });
    expect((await calls()).filter((x) => x[0] === "run")).toHaveLength(0);
  });
  await check("Save without testing skips the connection attempt", async () => {
    await fixture();
    await run().click();
    await dialog().getByRole("button", { name: "New connection" }).click();
    const connect = page.getByRole("dialog", { name: "Connect a database" });
    await connect.getByRole("radio", { name: "Manual", exact: true }).click();
    await connect
      .getByLabel("Connection name", { exact: true })
      .fill("Later warehouse");
    await connect.getByLabel("Host", { exact: true }).fill("10.0.0.10");
    await connect.getByLabel("Database", { exact: true }).fill("warehouse");
    await connect.getByLabel(/^Username/).fill("analyst");
    await connect.getByRole("button", { name: "Save without testing" }).click();
    await expect(connect).toHaveCount(0);
    await expect(page.locator(".workspace-notice")).toContainText(
      "Saved “Later warehouse” without testing",
    );
    const recorded = await calls();
    expect(
      recorded.filter((x) => x[0] === "connect" || x[0] === "testConnection"),
    ).toHaveLength(0);
    expect(recorded.find((x) => x[0] === "saveConnection")?.[1]).toMatchObject({
      name: "Later warehouse",
      kind: "postgres",
      host: "10.0.0.10",
      database: "warehouse",
      username: "analyst",
      connectionString: "",
    });
    expect(recorded.filter((x) => x[0] === "run")).toHaveLength(0);
  });
  await check(
    "single-database PostgreSQL connection switches databases in place",
    async () => {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("database:connect-saved");
        ipcMain.handle("database:connect-saved", (_event, id) => {
          globalThis.__querySmokeState.calls.push(["connectSaved", id]);
          const value = {
            id: "switch-pg",
            name: "Switchable PostgreSQL",
            kind: "postgres",
            host: "db.example.test",
            port: 5432,
            database: "appdb",
            username: "tester",
            connected: true,
            savedConnectionId: id,
          };
          globalThis.__querySmokeState.connections.push(value);
          return value;
        });
      });
      await fixture();
      await run().click();
      await dialog()
        .getByRole("button", { name: "Reconnect Saved PostgreSQL" })
        .click();
      await expect(dialog()).toHaveCount(0);
      await page.getByRole("button", { name: "Open explorer sidebar" }).click();
      const card = page
        .locator(".db-connection-list .db-browser-server")
        .filter({ hasText: "Switchable PostgreSQL" });
      await expect(card).toContainText("PostgreSQL · appdb");
      await card.hover();
      await card
        .getByRole("button", {
          name: "Switch database on Switchable PostgreSQL",
        })
        .click();
      const switcher = card.getByRole("dialog", { name: "Switch database" });
      await expect(
        switcher.getByRole("button", { name: /otherdb/ }),
      ).toBeVisible();
      await switcher.getByRole("button", { name: /otherdb/ }).click();
      await expect(switcher).toHaveCount(0);
      await expect(card).toContainText("PostgreSQL · otherdb");
      const recorded = await calls();
      expect(recorded.find((x) => x[0] === "switchDatabase")).toEqual([
        "switchDatabase",
        "switch-pg",
        "otherdb",
      ]);
      expect(recorded.filter((x) => x[0] === "run")).toHaveLength(0);
    },
  );
  await check(
    "clicking the selected connection folds its tree, and edit renames it",
    async () => {
      await app.evaluate(({ ipcMain }) => {
        for (const channel of ["database:get-saved", "database:update-saved"])
          ipcMain.removeHandler(channel);
        ipcMain.handle("database:get-saved", (_event, id) => {
          globalThis.__querySmokeState.calls.push(["getSaved", id]);
          return {
            name: "Switchable PostgreSQL",
            kind: "postgres",
            host: "db.example.test",
            port: 5432,
            database: "appdb",
            username: "tester",
            password: "secret",
            tls: false,
            sslMode: "prefer",
            serverMode: false,
            connectionString: "",
          };
        });
        ipcMain.handle("database:update-saved", (_event, id, input) => {
          globalThis.__querySmokeState.calls.push(["updateSaved", id, input]);
          return { ...input, id, hasSecret: true };
        });
      });
      const card = page
        .locator(".db-connection-list .db-browser-server")
        .filter({ hasText: "Switchable PostgreSQL" });
      const select = card.locator(".db-connection-select");
      if (!(await card.locator(".db-connection.selected").count()))
        await select.click();
      await expect(select).toHaveAttribute("aria-expanded", "true");
      await select.click();
      await expect(select).toHaveAttribute("aria-expanded", "false");
      await select.click();
      await expect(select).toHaveAttribute("aria-expanded", "true");

      await card.hover();
      await card
        .getByRole("button", { name: "Edit Switchable PostgreSQL" })
        .click();
      const edit = page.getByRole("dialog", { name: "Edit connection" });
      await expect(
        edit.getByLabel("Connection name", { exact: true }),
      ).toHaveValue("Switchable PostgreSQL");
      await expect(edit.getByLabel("Host", { exact: true })).toHaveValue(
        "db.example.test",
      );
      await expect(
        edit.getByRole("button", { name: "Connect", exact: true }),
      ).toHaveCount(0);
      await edit
        .getByLabel("Connection name", { exact: true })
        .fill("Renamed PostgreSQL");
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expect(edit).toHaveCount(0);
      await expect(
        page
          .locator(".db-connection-list .db-browser-server")
          .filter({ hasText: "Renamed PostgreSQL" }),
      ).toHaveCount(1);
      const recorded = await calls();
      const update = recorded.find((x) => x[0] === "updateSaved");
      expect(update?.[1]).toBe("saved-pg");
      expect(update?.[2]).toMatchObject({
        name: "Renamed PostgreSQL",
        host: "db.example.test",
        password: "secret",
      });
    },
  );
  await page.waitForTimeout(700);
  expect(errors).toEqual([]);
  await writeFile(
    join(artifacts, "query-connection-smoke-results.json"),
    JSON.stringify({ checks, errors }, null, 2) + "\n",
  );
  console.log(`ALL QUERY CONNECTION CHECKS PASSED (${checks.length})`);
} catch (error) {
  await page
    .screenshot({ path: join(artifacts, "query-connection-smoke-failure.png") })
    .catch(() => {});
  console.error(
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  throw error;
} finally {
  await app.close().catch(() => {});
}
