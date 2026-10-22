import { _electron as electron, expect } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const artifacts = join(process.cwd(), "artifacts");
await mkdir(artifacts, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), "rowfish-layout-"));
const app = await electron.launch({
  executablePath: join(process.cwd(), "node_modules/electron/dist/electron"),
  args: ["--no-sandbox", `--user-data-dir=${userData}`, "out/main/index.js"],
  env: { ...process.env },
});
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
const revealRail = async () => {
  if (!(await page.locator(".db-rail").isVisible()))
    await page.locator(".rail-reveal-edge").hover();
  await expect(page.locator(".db-rail")).toBeVisible();
};
const check = async (name, fn) => {
  await fn();
  console.log("PASS", name);
};
try {
  await page.waitForSelector(".cm-content");
  await check(
    "closed explorer preserves full query width and settings remains reachable",
    async () => {
      await expect(page.locator(".db-rail")).toBeHidden();
      let main = await page.locator(".db-main").boundingBox();
      const workspace = await page.locator(".db-workspace").boundingBox();
      expect(main.width).toBeGreaterThan(workspace.width * 0.95);
      // Hovering the left edge peeks the explorer out over the workspace.
      await revealRail();
      main = await page.locator(".db-main").boundingBox();
      expect(main.width).toBeGreaterThan(workspace.width * 0.95);
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(
        page.getByRole("heading", { name: /Settings/i }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: /Back|Close settings/i })
        .first()
        .click();
      await expect(page.locator(".cm-content")).toBeVisible();
      // Back from Settings leaves the rail peeked on the gear; moving away hides it.
      await page.mouse.move(800, 300);
      await page.mouse.move(820, 320);
      await expect(page.locator(".db-rail")).toBeHidden();
    },
  );
  await check(
    "toggle docks explorer and shifts main; Escape keeps it; rail button collapses",
    async () => {
      await page.locator(".sidebar-toggle").click();
      await expect(page.locator(".db-rail")).toBeVisible();
      await expect(page.locator(".db-workspace")).toHaveClass(/sidebar-docked/);
      const rail = await page.locator(".db-rail").boundingBox();
      const main = await page.locator(".db-main").boundingBox();
      expect(main.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1);
      await page.keyboard.press("Escape");
      await expect(page.locator(".db-rail")).toBeVisible();
      await page
        .getByRole("button", { name: "Collapse explorer sidebar" })
        .click();
      await expect(page.locator(".db-rail")).toBeHidden();
      await expect(page.locator(".sidebar-toggle")).toBeVisible();
      // Peek from the edge, then pin it with the same button.
      await page.locator(".rail-reveal-edge").hover();
      await expect(page.locator(".db-rail")).toBeVisible();
      await page.getByRole("button", { name: "Pin explorer sidebar" }).click();
      await expect(page.locator(".db-workspace")).toHaveClass(/sidebar-docked/);
      await page
        .getByRole("button", { name: "Collapse explorer sidebar" })
        .click();
      await expect(page.locator(".db-rail")).toBeHidden();
      await page.mouse.move(800, 300);
      await page.locator(".sidebar-toggle").click();
      await expect(page.locator(".db-rail")).toBeVisible();
    },
  );
  await check(
    "sidebar pointer drag and keyboard adjustment update persisted size",
    async () => {
      const sep = page.getByRole("separator", {
        name: "Resize explorer sidebar",
      });
      const before = Number(await sep.getAttribute("aria-valuenow"));
      const box = await sep.boundingBox();
      await page.mouse.move(box.x + 4, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 44, box.y + 100, { steps: 5 });
      await page.mouse.up();
      await expect
        .poll(async () => Number(await sep.getAttribute("aria-valuenow")))
        .toBeGreaterThan(before);
      const drag = Number(await sep.getAttribute("aria-valuenow"));
      await sep.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(sep).toHaveAttribute("aria-valuenow", String(drag - 10));
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("rowfish.layout.v1")).sidebar,
        ),
      ).toBe(drag - 10);
    },
  );
  await check(
    "editor/results splitter responds to drag and keyboard with persisted split",
    async () => {
      await page.keyboard.press("Escape");
      await expect(page.locator(".db-rail")).toBeHidden();
      const editorBefore = await page.locator(".db-editor-card").boundingBox();
      const resultsBefore = await page
        .locator(".db-results-card")
        .boundingBox();
      const sep = page.getByRole("separator", {
        name: "Resize editor and results split",
      });
      const before = Number(await sep.getAttribute("aria-valuenow"));
      const box = await sep.boundingBox();
      await page.mouse.move(box.x + 30, box.y + 4);
      await page.mouse.down();
      await page.mouse.move(box.x + 30, box.y + 104, { steps: 5 });
      await page.mouse.up();
      await expect
        .poll(async () => Number(await sep.getAttribute("aria-valuenow")))
        .toBeGreaterThan(before);
      const editorAfter = await page.locator(".db-editor-card").boundingBox();
      const resultsAfter = await page.locator(".db-results-card").boundingBox();
      expect(editorAfter.height).toBeGreaterThan(editorBefore.height + 50);
      expect(resultsAfter.height).toBeLessThan(resultsBefore.height - 50);
      const drag = Number(await sep.getAttribute("aria-valuenow"));
      await sep.focus();
      await page.keyboard.press("ArrowDown");
      await expect(sep).toHaveAttribute("aria-valuenow", String(drag + 1));
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("rowfish.layout.v1")).split,
        ),
      ).toBe(drag + 1);
    },
  );
  await check(
    "small native window retains usable full-width editor and bounded dialog sizing",
    async () => {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1000, 640),
      );
      await page.waitForTimeout(200);
      const main = await page.locator(".db-main").boundingBox();
      const workspace = await page.locator(".db-workspace").boundingBox();
      expect(main.width).toBeGreaterThan(workspace.width * 0.95);
      expect(await page.locator(".cm-content").boundingBox()).not.toBeNull();
      await page.screenshot({
        path: join(artifacts, "layout-smoke-1000x640.png"),
      });
      await page.locator(".sidebar-toggle").click();
      await expect(
        page.getByRole("separator", { name: "Resize explorer sidebar" }),
      ).toBeVisible();
      await page.screenshot({
        path: join(artifacts, "layout-smoke-sidebar-open.png"),
      });
    },
  );
  await check(
    "native window and query connection dialog are resizable",
    async () => {
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isResizable(),
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Select connection", exact: true })
        .click();
      const modal = page.getByRole("dialog", {
        name: "Choose a query connection",
      });
      await expect(modal).toHaveCSS("resize", "both");
      const before = await modal.boundingBox();
      await page.mouse.move(
        before.x + before.width - 10,
        before.y + before.height - 10,
      );
      await page.mouse.down();
      await page.mouse.move(
        before.x + before.width + 57,
        before.y + before.height + 27,
        { steps: 5 },
      );
      await page.mouse.up();
      await expect
        .poll(async () => (await modal.boundingBox()).width)
        .toBeGreaterThan(before.width + 30);
      await page.keyboard.press("Escape");
    },
  );
  console.log("LAYOUT SMOKE PASSED");
} catch (error) {
  await page
    .screenshot({ path: join(artifacts, "layout-smoke-failure.png") })
    .catch(() => {});
  console.error("LAYOUT SMOKE FAILED", error);
  process.exitCode = 1;
} finally {
  await app.close();
}
