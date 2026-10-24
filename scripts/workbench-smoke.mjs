import { Client } from "pg";
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const artifacts = join(process.cwd(), "artifacts");
await mkdir(artifacts, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), "rowfish-smoke-"));
const checks = [];
const app = await electron.launch({
  executablePath: join(process.cwd(), "node_modules/electron/dist/electron"),
  args: ["--no-sandbox", `--user-data-dir=${userData}`, "out/main/index.js"],
  env: { ...process.env },
});
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => console.error("PAGE ERROR", error.message));
const check = async (name, fn) => {
  await fn();
  checks.push(name);
  console.log("PASS", name);
};
const editor = () => page.locator(".cm-content");
const ensureSidebar = async () => {
  const rail = page.locator(".db-rail");
  if (!(await rail.isVisible())) await page.locator(".sidebar-toggle").click();
  await expect(rail).toBeVisible();
};
const sidebarTab = async (name) => {
  await ensureSidebar();
  await page.getByRole("tab", { name, exact: true }).click();
};
const inputQuery = async (query) => {
  if (await page.locator(".db-rail").isVisible())
    await page.keyboard.press("Escape");
  await editor().click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(query);
};
try {
  await page.waitForSelector(".cm-content");
  await check("Electron 45 runtime", async () =>
    expect(await app.evaluate(() => process.versions.electron)).toMatch(
      /^45\./,
    ),
  );
  await check("Tab accepts the selected keyword completion", async () => {
    await inputQuery("SEL");
    await page.keyboard.press("Control+Space");
    const selected = page.locator(
      '.cm-tooltip-autocomplete [aria-selected="true"]',
    );
    await expect(selected).toContainText("SELECT");
    // CodeMirror briefly ignores completion keys after opening the popup.
    await page.waitForTimeout(100);
    await page.keyboard.press("Tab");
    await expect(editor()).toHaveText("SELECT");
    await expect(page.locator(".cm-tooltip-autocomplete")).not.toBeVisible();
  });
  await check(
    "Tab indents and Shift-Tab unindents without a completion",
    async () => {
      await inputQuery("SELECT 1;");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Tab");
      await expect(editor()).toHaveText("  SELECT 1;", { useInnerText: false });
      await page.keyboard.press("Shift+Tab");
      await expect(editor()).toHaveText("SELECT 1;");
    },
  );
  await check("offline drafts autosave across reload", async () => {
    await inputQuery("SELECT 42 AS answer;");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("rowfish.query-workspace.v1") ?? "{}",
            )?.tabs?.[0]?.query,
        ),
      )
      .toBe("SELECT 42 AS answer;");
    await page.reload();
    await expect(editor()).toHaveText("SELECT 42 AS answer;");
  });
  await check("named queries saved internally", async () => {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByLabel("Query name").fill("Fixture answer");
    await page.getByRole("button", { name: "Save query", exact: true }).click();
    await expect(page.locator(".library-item")).toContainText("Fixture answer");
  });
  await sidebarTab("Servers");
  await page.getByRole("button", { name: /New connection/ }).click();
  const modal = page.getByRole("dialog", { name: "Connect a database" });
  const connectMode = (name) =>
    modal.getByRole("radio", { name, exact: true }).click();
  await check(
    "connection dialog offers Connection string | Manual",
    async () => {
      await expect(
        modal.getByRole("radiogroup", { name: "How to connect" }),
      ).toBeVisible();
      await connectMode("Connection string");
      // No kind dropdown in connection string mode; the scheme decides.
      await expect(modal.getByLabel("Database type")).toHaveCount(0);
      await expect(modal.getByTestId("detected-kind")).toHaveText(
        "Type not detected",
      );
      await expect(
        modal.getByRole("button", { name: /^Connect$/ }),
      ).toBeDisabled();
      await connectMode("Manual");
      await expect(modal.getByLabel("Database type")).toHaveValue("postgres");
    },
  );
  await modal
    .getByLabel("Connection name", { exact: true })
    .fill("Local development");
  await modal.getByLabel("Host", { exact: true }).fill("localhost");
  await modal.getByLabel("Database", { exact: true }).fill("rowfish_fixture");
  await modal.getByLabel(/^Username/).fill("rowfish_test");
  await modal.getByLabel(/^Password/).fill("rowfish_local_fixture");
  const saveLabel = modal
    .locator("label")
    .filter({ hasText: "Save this connection" });
  if (await saveLabel.count()) await saveLabel.locator("input").uncheck();
  await check("connection string preview follows the fields", async () => {
    await expect(modal.locator(".db-uri-preview")).toHaveText(
      "postgresql://rowfish_test:••••••@localhost:5432/rowfish_fixture",
    );
  });
  await check(
    "connection string mode detects the type and syncs fields",
    async () => {
      await connectMode("Connection string");
      const uri = modal.getByLabel("Connection string", { exact: true });
      const badge = modal.getByTestId("detected-kind");
      const connectButton = modal.getByRole("button", { name: /^Connect$/ });
      await expect(uri).toHaveValue(
        "postgresql://rowfish_test:rowfish_local_fixture@localhost:5432/rowfish_fixture",
      );
      await expect(badge).toHaveText("Detected: PostgreSQL");
      await uri.fill("not-a-connection-string");
      await expect(modal.locator(".db-uri-hint.error")).toBeVisible();
      await expect(badge).toHaveText("Type not detected");
      await expect(connectButton).toBeDisabled();
      await expect(
        modal.getByRole("button", { name: "Test & Save" }),
      ).toBeDisabled();
      await expect(
        modal.getByRole("button", { name: "Save without testing" }),
      ).toBeDisabled();
      await uri.fill("");
      await expect(modal.locator(".db-uri-hint")).toContainText("detected");
      await expect(connectButton).toBeDisabled();
      // A complete scheme switches the kind and its default port right away.
      await uri.fill("mongodb://");
      await expect(badge).toHaveText("Detected: MongoDB");
      await expect(connectButton).toBeEnabled();
      await connectMode("Manual");
      await expect(modal.getByLabel("Database type")).toHaveValue("mongodb");
      await expect(modal.getByLabel("Port", { exact: true })).toHaveValue(
        "27017",
      );
      await connectMode("Connection string");
      await uri.fill("mongodb://app:secret@mongo.example:27018/inventory");
      await expect(badge).toHaveText("Detected: MongoDB");
      await expect(
        modal.getByRole("checkbox", { name: /Browse all databases/ }),
      ).toHaveCount(0);
      await connectMode("Manual");
      await expect(modal.getByLabel("Database type")).toHaveValue("mongodb");
      await expect(modal.getByLabel("Host", { exact: true })).toHaveValue(
        "mongo.example",
      );
      await expect(modal.getByLabel("Port", { exact: true })).toHaveValue(
        "27018",
      );
      await expect(modal.getByLabel("Database", { exact: true })).toHaveValue(
        "inventory",
      );
      await connectMode("Connection string");
      await expect(uri).toHaveValue(
        /^mongodb:\/\/app:secret@mongo\.example:27018\/inventory/,
      );
      await uri.fill(
        "postgresql://rowfish_test:rowfish_local_fixture@localhost:5432/rowfish_fixture?application_name=rowfish-smoke",
      );
      await expect(badge).toHaveText("Detected: PostgreSQL");
      await expect(modal.locator(".db-uri-hint")).toContainText(
        "application_name",
      );
      await connectMode("Manual");
      await expect(modal.getByLabel("Database type")).toHaveValue("postgres");
      await expect(modal.getByLabel("Host", { exact: true })).toHaveValue(
        "localhost",
      );
      await expect(modal.getByLabel("Port", { exact: true })).toHaveValue(
        "5432",
      );
      await expect(modal.getByLabel("Database", { exact: true })).toHaveValue(
        "rowfish_fixture",
      );
      await expect(modal.getByLabel(/^Password/)).toHaveValue(
        "rowfish_local_fixture",
      );
    },
  );
  await check("Test & Save against real PostgreSQL", async () => {
    // The test probe hits the real server; saving is recorded instead of
    // written because CI's Linux session has no OS credential store.
    await app.evaluate(({ ipcMain }) => {
      globalThis.__workbenchSaved = [];
      ipcMain.removeHandler("database:save-connection");
      ipcMain.handle("database:save-connection", (_event, input) => {
        globalThis.__workbenchSaved.push(input);
        return {
          id: "smoke-saved",
          name: input.name,
          kind: input.kind,
          host: input.host,
          port: input.port,
          database: input.database,
          username: input.username,
          tls: input.tls,
          serverMode: input.serverMode,
          hasSecret: true,
        };
      });
    });
    await connectMode("Connection string");
    await modal
      .getByLabel("Connection string", { exact: true })
      .fill(
        "postgresql://rowfish_test:rowfish_local_fixture@localhost:5432/rowfish_fixture?application_name=rowfish-smoke",
      );
    await modal.getByRole("button", { name: "Test & Save" }).click();
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    const notice = page.locator(".workspace-notice");
    await expect(notice).toContainText(
      "Saved “Local development”: connection succeeded",
    );
    await expect(notice).toContainText("PostgreSQL");
    const saved = await app.evaluate(() => globalThis.__workbenchSaved);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: "Local development",
      kind: "postgres",
      connectionString: expect.stringContaining(
        "application_name=rowfish-smoke",
      ),
    });
    await notice.getByRole("button", { name: "Dismiss notice" }).click();
  });
  await sidebarTab("Servers");
  await page.getByRole("button", { name: /New connection/ }).click();
  await expect(modal).toBeVisible();
  // The dialog reopens in the last used mode (connection string here).
  await expect(
    modal.getByRole("radio", { name: "Connection string", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await connectMode("Manual");
  await modal
    .getByLabel("Connection name", { exact: true })
    .fill("Local development");
  await modal.getByLabel("Host", { exact: true }).fill("localhost");
  await modal.getByLabel("Database", { exact: true }).fill("rowfish_fixture");
  await modal.getByLabel(/^Username/).fill("rowfish_test");
  await modal.getByLabel(/^Password/).fill("rowfish_local_fixture");
  if (await saveLabel.count()) await saveLabel.locator("input").uncheck();
  await modal.getByRole("button", { name: /^Connect$/ }).click();
  await check("real PostgreSQL connect and schema browser", async () => {
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await ensureSidebar();
    await expect(
      page.getByRole("button", { name: "customers", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: /^customer_totals/ }),
    ).toBeVisible();
  });
  await ensureSidebar();
  await page.getByRole("button", { name: "orders", exact: true }).click();
  await check("PostgreSQL structure metadata", async () => {
    await page.getByRole("button", { name: "Structure", exact: true }).click();
    await expect(page.locator(".metadata-table")).toContainText("customer_id", {
      timeout: 15000,
    });
    await expect(page.locator(".metadata-table")).toContainText(
      "numeric(12,2)",
    );
  });
  await check("PostgreSQL indexes and foreign keys", async () => {
    await page
      .getByRole("button", { name: "Indexes & constraints", exact: true })
      .click();
    await expect(page.locator(".metadata-panel")).toContainText(
      "orders_status_idx",
    );
    await expect(page.locator(".metadata-panel")).toContainText("FOREIGN KEY");
  });
  await page.getByRole("button", { name: "Results", exact: true }).click();
  await check(
    "single-click row side panel with schema and safe updates",
    async () => {
      await page.getByRole("button", { name: /Run query/ }).click();
      await expect(page.locator(".db-results-summary")).toContainText(
        "100 rows",
      );
      // PostgreSQL does not guarantee row order without ORDER BY. Follow the
      // actual displayed primary key, including after earlier updates.
      const inspectedId = Number(
        await page
          .locator(".db-result-table tbody tr")
          .first()
          .locator("td")
          .nth(1)
          .innerText(),
      );
      await page.locator(".db-result-table tbody tr").first().click();
      const panel = page.getByRole("complementary", { name: "Row details" });
      await expect(panel).toContainText("public.orders");
      await expect(panel).toContainText("numeric(12,2)");
      await expect(panel).toContainText("Primary key");
      const rowResize = page.getByRole("separator", {
        name: "Resize row details panel",
      });
      const panelBefore = await panel.boundingBox();
      const handle = await rowResize.boundingBox();
      await page.mouse.move(handle.x + 4, handle.y + 100);
      await page.mouse.down();
      await page.mouse.move(handle.x - 56, handle.y + 100, { steps: 5 });
      await page.mouse.up();
      await expect
        .poll(async () => (await panel.boundingBox()).width)
        .toBeGreaterThan(panelBefore.width + 40);
      const mainAfterResize = await page.locator(".db-main").boundingBox();
      const panelAfterResize = await panel.boundingBox();
      expect(mainAfterResize.x + mainAfterResize.width).toBeLessThanOrEqual(
        panelAfterResize.x,
      );
      const draggedWidth = Number(
        await rowResize.getAttribute("aria-valuenow"),
      );
      await rowResize.focus();
      await page.keyboard.press("ArrowRight");
      await expect(rowResize).toHaveAttribute(
        "aria-valuenow",
        String(draggedWidth - 10),
      );
      await page.keyboard.press("Home");

      await expect(
        panel.getByLabel("Value for id", { exact: true }),
      ).toHaveCount(0);
      const status = panel.getByLabel("Value for status", { exact: true });
      await expect(status).toBeEditable();
      const original = await status.inputValue();
      await status.fill("rowfish-sidepanel-smoke");
      await panel
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(panel.getByRole("status")).toContainText("Changes saved");
      await expect(
        page.locator(".db-result-table tbody tr").first(),
      ).toContainText("rowfish-sidepanel-smoke");
      // A second save must update the grid too, without reopening the panel.
      await status.fill(original);
      await panel
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeDisabled();
      await expect(
        page.locator(".db-result-table tbody tr").first(),
      ).not.toContainText("rowfish-sidepanel-smoke");
      const field = status.locator("..");
      await field.getByRole("checkbox", { name: "Set NULL" }).check();
      await panel
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(status).toBeDisabled();
      await expect(
        page.locator(".db-result-table tbody tr").first(),
      ).toContainText("NULL");
      await field.getByRole("checkbox", { name: "Set NULL" }).uncheck();
      await status.fill("");
      await panel
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeDisabled();
      const client = new Client({
        host: "localhost",
        database: "rowfish_fixture",
        user: "rowfish_test",
        password: "rowfish_local_fixture",
      });
      await client.connect();
      try {
        expect(
          (
            await client.query(
              "SELECT status FROM public.orders WHERE id = $1",
              [inspectedId],
            )
          ).rows[0].status,
        ).toBe("");
        await status.fill("pending-stale-edit");
        await client.query(
          "UPDATE public.orders SET status = 'externally-changed' WHERE id = $1",
          [inspectedId],
        );
        await panel
          .getByRole("button", { name: "Save changes", exact: true })
          .click();
        await expect(panel.getByRole("alert")).toContainText(
          /changed|stale|reload/i,
        );
        expect(
          (
            await client.query(
              "SELECT status FROM public.orders WHERE id = $1",
              [inspectedId],
            )
          ).rows[0].status,
        ).toBe("externally-changed");
        await panel
          .getByRole("button", { name: "Discard", exact: true })
          .click();
        await panel.getByRole("button", { name: "Close row details" }).click();
        await client.query(
          "UPDATE public.orders SET status = $1 WHERE id = $2",
          [original, inspectedId],
        );
      } finally {
        await client.end();
      }
      await page.getByRole("button", { name: /Run query/ }).click();
      await expect(page.locator(".db-results-summary")).toContainText(
        "100 rows",
      );
      await page.locator(".db-result-table tbody tr").first().focus();
      await page.keyboard.press("Enter");
      await expect(status).toBeEditable();
      const reopenedStatus = await status.inputValue();
      await status.fill("unsaved-value");
      page.once("dialog", (dialog) => dialog.dismiss());
      await panel.getByRole("button", { name: "Close row details" }).click();
      await expect(panel).toBeVisible();
      await expect(status).toHaveValue("unsaved-value");
      await panel.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(status).toHaveValue(reopenedStatus);
      const total = panel.getByLabel("Value for total", { exact: true });
      await total.fill("-10");
      await panel
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(panel.getByRole("alert")).toContainText(/check constraint/i);
      await expect(total).toHaveValue("-10");
      await panel.getByRole("button", { name: "Discard", exact: true }).click();
      await page.screenshot({
        path: join(artifacts, "rowfish-row-sidepanel.png"),
      });
      await panel.getByRole("button", { name: "Close row details" }).click();
    },
  );
  await check("schema and column autocomplete", async () => {
    await inputQuery("SELECT * FROM public.");
    await page.keyboard.press("Control+Space");
    await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
      "customers",
    );
    // Move off the initial item to verify Tab accepts the highlighted choice.
    await page.waitForTimeout(100);
    await page.keyboard.press("ArrowDown");
    const selectedTable = await page
      .locator(
        '.cm-tooltip-autocomplete [aria-selected="true"] .cm-completionLabel',
      )
      .innerText();
    await page.keyboard.press("Tab");
    await expect(editor()).toHaveText(`SELECT * FROM public.${selectedTable}`);
    await expect(page.locator(".cm-tooltip-autocomplete")).not.toBeVisible();
    await inputQuery("SELECT * FROM public.orders WHERE orders.");
    await page.keyboard.press("Control+Space");
    await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
      "customer_id",
    );
    await page.waitForTimeout(100);
    const selectedColumn = await page
      .locator(
        '.cm-tooltip-autocomplete [aria-selected="true"] .cm-completionLabel',
      )
      .innerText();
    await page.keyboard.press("Tab");
    await expect(editor()).toHaveText(
      `SELECT * FROM public.orders WHERE orders.${selectedColumn}`,
    );
    await expect(page.locator(".cm-tooltip-autocomplete")).not.toBeVisible();
  });
  await check("multi-statement scripts and final result", async () => {
    await inputQuery("SELECT 1 AS first; SELECT 2 AS final;");
    await page.getByRole("button", { name: /Run query/ }).click();
    await expect(page.locator(".db-results-summary")).toContainText(
      "2 statements",
      { timeout: 15000 },
    );
    await expect(page.locator(".db-result-table")).toContainText("final");
  });
  await check("empty results retain column headings", async () => {
    await inputQuery("SELECT id, email FROM public.customers WHERE false;");
    await page.getByRole("button", { name: /Run query/ }).click();
    await expect(page.locator(".db-results-summary")).toContainText("0 rows", {
      timeout: 15000,
    });
    await expect(page.locator(".db-result-table thead")).toContainText("email");
  });
  await check("query streaming and result sorting", async () => {
    await inputQuery(
      "SELECT id, customer_id, total, status FROM public.orders ORDER BY id LIMIT 30;",
    );
    await page.getByRole("button", { name: /Run query/ }).click();
    await expect(page.locator(".db-results-summary")).toContainText("30 rows", {
      timeout: 15000,
    });
    expect(
      await page
        .locator(".db-result-table tbody tr:not(.db-spacer-row)")
        .count(),
    ).toBeGreaterThan(0);
    expect(
      await page
        .locator(".db-result-table tbody tr:not(.db-spacer-row)")
        .count(),
    ).toBeLessThanOrEqual(30);
    await page
      .locator("th")
      .getByRole("button", { name: /^total/ })
      .click();
    await page
      .locator("th")
      .getByRole("button", { name: /^total/ })
      .click();
    await expect(
      page.locator(".db-result-table tbody tr").first(),
    ).toContainText("375.00");
  });
  await check("results view toggle switches list, JSON and table", async () => {
    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.locator(".db-doc-card").first()).toContainText(
      "customer_id",
    );
    await page.getByRole("button", { name: "JSON view" }).click();
    await expect(page.locator(".db-doc-json").first()).toContainText(
      '"status"',
    );
    await page.getByRole("button", { name: "Table view" }).click();
    await expect(
      page.locator(".db-result-table tbody tr").first(),
    ).toContainText("375.00");
  });
  await check("history records actual query outcome", async () => {
    await sidebarTab("History");
    await expect(page.locator(".history-status.success").first()).toContainText(
      "Local development",
    );
    await expect(page.locator(".library-item").first()).toContainText(
      "SELECT id",
    );
  });
  await check("filtered export and row inspector", async () => {
    await page.getByLabel("Filter result rows").fill("complete");
    await expect(page.locator(".db-row-count")).toContainText("20 / 30");
    await app.evaluate(
      ({ session }, path) => {
        session.defaultSession.once("will-download", (_event, item) => {
          item.setSavePath(path);
          item.once("done", (_event, state) => {
            globalThis.__rowfishDownload = state;
          });
        });
      },
      join(artifacts, "fixture-results.csv"),
    );
    await page.getByRole("button", { name: "CSV", exact: true }).click();
    await expect
      .poll(() => app.evaluate(() => globalThis.__rowfishDownload))
      .toBe("completed");
    await page.locator(".db-result-table tbody tr").first().click();
    await expect(
      page.getByRole("complementary", { name: "Row details" }),
    ).toContainText("customer_id");
    await expect(
      page.getByRole("complementary", { name: "Row details" }),
    ).toContainText("Query result · read only");
    await expect(
      page
        .getByRole("complementary", { name: "Row details" })
        .getByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
    await page
      .getByRole("complementary", { name: "Row details" })
      .getByRole("button", { name: "Close row details" })
      .click();
    await page.getByLabel("Filter result rows").fill("");
  });
  await sidebarTab("Servers");
  await check("server browser opens an accessible database", async () => {
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await ensureSidebar();
    await page.getByRole("button", { name: /New connection/ }).click();
    const dialog = page.getByRole("dialog", { name: "Connect a database" });
    await dialog.getByRole("radio", { name: "Manual", exact: true }).click();
    await dialog
      .getByLabel("Connection name", { exact: true })
      .fill("Development server");
    await dialog.getByLabel("Host", { exact: true }).fill("localhost");
    await dialog.getByLabel(/^Username/).fill("rowfish_test");
    await dialog.getByLabel(/^Password/).fill("rowfish_local_fixture");
    await dialog
      .getByRole("checkbox", { name: /Browse all databases/ })
      .check();
    await dialog
      .getByRole("checkbox", { name: /Save this connection/ })
      .uncheck();
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 20000 });
    await ensureSidebar();
    await page
      .locator(".db-browser-database")
      .filter({ hasText: "rowfish_fixture" })
      .click();
    await expect(
      page.getByRole("button", { name: "orders", exact: true }),
    ).toBeVisible({ timeout: 15000 });
  });
  await check(
    "cancel terminates active SQL and records cancellation",
    async () => {
      await inputQuery("SELECT pg_sleep(20);");
      await page.getByRole("button", { name: /Run query/ }).click();
      await page.locator(".db-cancel-button").click();
      await sidebarTab("History");
      await expect(
        page.locator(".history-status.cancelled").first(),
      ).toBeVisible();
      await sidebarTab("Servers");
      await ensureSidebar();
      await page
        .locator(".db-browser-database")
        .filter({ hasText: "rowfish_fixture" })
        .click();
      await expect(
        page.getByRole("button", { name: "orders", exact: true }),
      ).toBeVisible({ timeout: 15000 });
    },
  );
  await check("query result bounds truncate safely", async () => {
    await page.getByLabel("Max rows", { exact: true }).selectOption("500");
    await inputQuery("SELECT generate_series(1, 600) AS number;");
    await page.getByRole("button", { name: /Run query/ }).click();
    await expect(page.locator(".db-results-summary")).toContainText(
      "500 rows",
      { timeout: 15000 },
    );
    await expect(page.locator(".db-results-summary")).toContainText(
      "result capped",
    );
  });
  await check("column filter narrows rows Excel-style", async () => {
    await page
      .locator(".db-result-table th")
      .filter({ hasText: "number" })
      .hover();
    await page.getByRole("button", { name: "Filter number" }).click();
    const menu = page.getByRole("dialog", { name: "Filter number" });
    await menu.getByLabel("Condition").fill(">490");
    await expect(page.locator(".db-row-count")).toContainText("10 / 500");
    await menu.getByLabel("Condition").fill("");
    await menu.getByRole("checkbox", { name: /Select all/ }).uncheck();
    await menu.getByRole("checkbox", { name: /^1\b/ }).first().check();
    await expect(page.locator(".db-row-count")).toContainText("1 / 500");
    await menu.getByRole("button", { name: "Done" }).click();
    await expect(menu).toHaveCount(0);
    await page.getByRole("button", { name: /Clear filters/ }).click();
    await expect(page.locator(".db-row-count")).not.toContainText("/");
  });
  await ensureSidebar();
  await page.getByRole("button", { name: "orders", exact: true }).click();
  await inputQuery(
    "SELECT id, customer_id, total, status FROM public.orders ORDER BY id LIMIT 30;",
  );
  await page.getByRole("button", { name: /Run query/ }).click();
  await expect(page.locator(".db-results-summary")).toContainText("30 rows", {
    timeout: 15000,
  });
  await page.screenshot({ path: join(artifacts, "rowfish-workbench.png") });
  await writeFile(
    join(artifacts, "smoke-results.json"),
    JSON.stringify(
      {
        runtime: await app.evaluate(() => process.versions.electron),
        checks,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("ALL CHECKS PASSED");
} catch (error) {
  await page
    .screenshot({ path: join(artifacts, "smoke-failure.png") })
    .catch(() => {});
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await app.close();
}
