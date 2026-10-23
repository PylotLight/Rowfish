import { _electron as electron, expect } from "@playwright/test";
import { Client } from "pg";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const artifacts = join(process.cwd(), "artifacts");
await mkdir(artifacts, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), "rowfish-modern-"));
const app = await electron.launch({
  executablePath: join(process.cwd(), "node_modules/electron/dist/electron"),
  args: ["--no-sandbox", `--user-data-dir=${userData}`, "out/main/index.js"],
  env: { ...process.env },
});
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
const check = async (name, run) => {
  await run();
  checks.push(name);
  console.log("PASS", name);
};
const editor = () => page.locator(".cm-content");
const ensureSidebar = async () => {
  const rail = page.locator(".db-rail");
  if (!(await rail.isVisible())) await page.locator(".sidebar-toggle").click();
  await expect(rail).toBeVisible();
};
const inputQuery = async (query) => {
  if (await page.locator(".db-rail").isVisible())
    await page.keyboard.press("Escape");
  await editor().click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(query);
};
const revealRail = async () => {
  if (!(await page.locator(".db-rail").isVisible()))
    await page.locator(".rail-reveal-edge").hover();
  await expect(page.locator(".db-rail")).toBeVisible();
};
const appearance = () =>
  page.getByRole("button", { name: "Settings", exact: true });
const runQuery = async () => {
  await page.getByRole("button", { name: /Run query/ }).click();
  await expect(page.getByRole("button", { name: /Run query/ })).toBeEnabled();
  await expect(page.locator(".db-results-summary")).not.toContainText(
    /Running|Executing/i,
  );
};
const plan = () => page.getByRole("region", { name: "Query execution plan" });
try {
  await page.waitForSelector(".cm-content");
  await check("Glass default and comfortable editor text", async () => {
    await expect(page.locator("html")).toHaveAttribute(
      "data-appearance",
      "glass",
    );
    await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "14px");
  });
  await check(
    "AMOLED uses opaque black main surfaces and persists",
    async () => {
      await revealRail();
      await appearance().click();
      await page
        .getByRole("radio", { name: "AMOLED black", exact: true })
        .click();
      for (const selector of [
        ".shell",
        ".db-main",
        ".db-results-card",
        ".cm-editor",
      ])
        await expect(page.locator(selector)).toHaveCSS(
          "background-color",
          "rgb(0, 0, 0)",
        );
      await page.getByRole("radio", { name: "Compact", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-text-density",
        "compact",
      );
      await page.keyboard.press("Escape");
      await expect(appearance()).toBeFocused();
      await expect(
        page.getByRole("region", { name: "Settings", exact: true }),
      ).not.toBeVisible();
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute(
        "data-appearance",
        "amoled",
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-text-density",
        "compact",
      );
      await revealRail();
      await appearance().click();
      await page
        .getByRole("radio", { name: "Comfortable", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("region", { name: "Settings", exact: true }),
      ).not.toBeVisible();
    },
  );
  await ensureSidebar();
  await page.getByRole("button", { name: /New connection/ }).click();
  const modal = page.getByRole("dialog", { name: "Connect a database" });
  await modal.getByRole("radio", { name: "Manual", exact: true }).click();
  await modal
    .getByLabel("Connection name", { exact: true })
    .fill("Local PostgreSQL");
  await modal.getByLabel("Host", { exact: true }).fill("localhost");
  await modal.getByLabel("Database", { exact: true }).fill("rowfish_fixture");
  await modal.getByLabel(/^Username/).fill("rowfish_test");
  await modal.getByLabel(/^Password/).fill("rowfish_local_fixture");
  await modal.getByRole("checkbox", { name: /Save this connection/ }).uncheck();
  await modal.getByRole("button", { name: /^Connect$/ }).click();
  await expect(modal).not.toBeVisible({ timeout: 20000 });
  await ensureSidebar();
  await expect(
    page.getByRole("button", { name: "orders", exact: true }),
  ).toBeVisible();

  await check(
    "Explain displays real serialized PostgreSQL plan hierarchy",
    async () => {
      await inputQuery(
        "SELECT c.name, sum(o.total) AS revenue\nFROM public.customers c\nJOIN public.orders o ON o.customer_id = c.id\nGROUP BY c.name\nORDER BY revenue DESC;",
      );
      await page.getByTestId("explain-query").click();
      await expect(plan()).toBeVisible();
      await expect(plan().locator(".pg-plan-operator").first()).toContainText(
        /Sort|Aggregate/,
      );
      await expect(plan()).toContainText("customers");
      await expect(plan()).toContainText("orders");
      const collapse = plan()
        .getByRole("button", { name: /^Collapse/ })
        .first();
      await collapse.click();
      await expect(plan().locator(".pg-plan-operator")).toHaveCount(1);
      await plan()
        .getByRole("button", { name: /^Expand/ })
        .first()
        .click();
      expect(await plan().locator(".pg-plan-operator").count()).toBeGreaterThan(
        1,
      );
      await plan()
        .getByText("Raw EXPLAIN result JSON", { exact: true })
        .click();
      await expect(plan().locator("pre")).toContainText('"Node Type"');
      await plan()
        .getByText("Raw EXPLAIN result JSON", { exact: true })
        .click();
      await plan().evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({
        path: join(artifacts, "rowfish-amoled-plan.png"),
      });
    },
  );
  await check(
    "Explain selection is scoped to SQL editor and never runs the rest",
    async () => {
      await inputQuery("SELECT 7 AS selected; SELECT pg_sleep(10);");
      await page.keyboard.press("Control+Home");
      await page.keyboard.press("Control+Shift+ArrowRight");
      // Select the exact first statement through CodeMirror's native DOM selection.
      await page.keyboard.press("Home");
      for (let i = 0; i < "SELECT 7 AS selected;".length; i++)
        await page.keyboard.press("Shift+ArrowRight");
      await page.getByTestId("explain-query").click();
      await expect(plan()).toBeVisible();
      await expect(plan()).toContainText("Result");
      await expect(editor()).toContainText("pg_sleep(10)");
    },
  );
  await check(
    "Explain rejects scripts, ANALYZE, and write commands without execution",
    async () => {
      const client = new Client({
        host: "localhost",
        database: "rowfish_fixture",
        user: "rowfish_test",
        password: "rowfish_local_fixture",
      });
      await client.connect();
      try {
        const before = (
          await client.query("SELECT count(*) FROM public.orders")
        ).rows[0].count;
        for (const query of [
          "SELECT 1; DELETE FROM public.orders;",
          "EXPLAIN ANALYZE DELETE FROM public.orders;",
          "DELETE FROM public.orders;",
        ]) {
          await inputQuery(query);
          await page.getByTestId("explain-query").click();
          await expect(page.locator(".db-query-error")).toBeVisible();
          expect(
            (await client.query("SELECT count(*) FROM public.orders")).rows[0]
              .count,
          ).toBe(before);
        }
      } finally {
        await client.end();
      }
    },
  );
  await check(
    "normal query restores result grid and readable AMOLED rows",
    async () => {
      await inputQuery(
        "SELECT id, customer_id, total, status FROM public.orders ORDER BY id LIMIT 30;",
      );
      await runQuery();
      await expect(page.locator(".db-results-summary")).toContainText(
        "30 rows",
      );
      await expect(plan()).not.toBeVisible();
      await expect(page.locator(".db-result-table td").first()).toHaveCSS(
        "font-size",
        "13px",
      );
      await page.screenshot({ path: join(artifacts, "rowfish-amoled.png") });
    },
  );
  await check(
    "all diagnostics open unexecuted drafts and run successfully on PostgreSQL",
    async () => {
      for (const id of ["sessions", "sizes", "index-usage", "blocking"]) {
        // Query workspace persistence is deliberately debounced by 250 ms.
        await page.waitForTimeout(350);
        const before = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("rowfish.query-workspace.v1"))
              .history.length,
        );
        await page.getByLabel("PostgreSQL diagnostic query").selectOption(id);
        await expect(editor()).toContainText("SELECT");
        await expect(page.locator(".db-results-summary")).toContainText(
          "Ready to execute",
        );
        await expect(plan()).not.toBeVisible();
        await page.waitForTimeout(350);
        const after = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("rowfish.query-workspace.v1"))
              .history.length,
        );
        expect(after).toBe(before);
        await runQuery();
        await expect(page.locator(".db-query-error")).not.toBeVisible();
        await expect(page.locator(".db-results-summary")).toContainText(
          /\d+ rows/,
        );
      }
    },
  );
  await check("Glass and minimum window retain usable tools", async () => {
    await revealRail();
    await appearance().click();
    await page.getByRole("radio", { name: "Glass", exact: true }).click();
    await page.keyboard.press("Escape");
    await ensureSidebar();
    await page.getByRole("button", { name: "orders", exact: true }).click();
    // Clicking a table runs its SELECT straight away.
    // Wait for the finished summary, not "Query running · 0 rows received".
    await expect(page.locator(".db-results-summary")).toHaveText(
      /^\d+ rows · /,
      { timeout: 15000 },
    );
    await expect(page.getByRole("button", { name: /Run query/ })).toBeEnabled();
    // Each tab keeps its own results: a new tab is empty, going back restores.
    // Read the summary only once it holds still at a finished "N rows" value,
    // so a late re-run of the table query cannot be captured mid-flight.
    let ordersSummary = "";
    await expect
      .poll(
        async () => {
          const before = await page
            .locator(".db-results-summary")
            .textContent();
          await page.waitForTimeout(400);
          const after = await page.locator(".db-results-summary").textContent();
          ordersSummary = after ?? "";
          return before === after && /^\d+ rows · /.test(ordersSummary);
        },
        { timeout: 15000 },
      )
      .toBe(true);
    await page.getByRole("button", { name: "New query tab" }).click();
    await expect(page.locator(".db-results-summary")).not.toContainText(
      /\d+ rows/,
    );
    await page.getByRole("tab", { name: /orders/ }).click();
    await expect(page.locator(".db-results-summary")).toHaveText(
      ordersSummary ?? "",
    );
    await inputQuery(
      "SELECT id, customer_id, total, status FROM public.orders ORDER BY id LIMIT 30;",
    );
    await runQuery();
    await expect(page.locator(".db-results-summary")).toContainText("30 rows");
    await page.screenshot({ path: join(artifacts, "rowfish-glass.png") });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 640),
    );
    // Settings lives in the explorer footer, which peeks out from the left edge.
    await revealRail();
    const gear = await appearance().boundingBox();
    expect(gear.x).toBeGreaterThanOrEqual(0);
    expect(gear.x + gear.width).toBeLessThanOrEqual(1000);
    const collapse = page.getByRole("button", {
      name: "Collapse explorer sidebar",
    });
    if (await collapse.isVisible()) await collapse.click();
    else await page.keyboard.press("Escape");
    await page.mouse.move(800, 300);
    await expect(page.locator(".db-rail")).toBeHidden();
    for (const target of [
      page.getByTestId("explain-query"),
      page.getByRole("button", { name: /Run query/ }),
      page.getByLabel("PostgreSQL diagnostic query"),
    ]) {
      await expect(target).toBeVisible();
      const box = await target.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1000);
    }
    expect(
      await editor().evaluate((node) => node.getBoundingClientRect().height),
    ).toBeGreaterThan(40);
    await page.screenshot({
      path: join(artifacts, "rowfish-minimum-window.png"),
    });
  });
  expect(errors).toEqual([]);
  await writeFile(
    join(artifacts, "modern-smoke-results.json"),
    JSON.stringify({ checks, errors }, null, 2) + "\n",
  );
  console.log("ALL MODERN WORKBENCH CHECKS PASSED");
} catch (error) {
  await page
    .screenshot({ path: join(artifacts, "modern-smoke-failure.png") })
    .catch(() => {});
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await app.close();
}
