import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const artifacts = join(process.cwd(), "artifacts");
await mkdir(artifacts, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), "rowfish-settings-"));
const app = await electron.launch({
  executablePath: join(process.cwd(), "node_modules/electron/dist/electron"),
  args: ["--no-sandbox", `--user-data-dir=${userData}`, "out/main/index.js"],
  env: { ...process.env },
});
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const settings = () =>
  page.getByRole("button", { name: "Settings", exact: true });
const panel = () => page.getByRole("region", { name: "Settings", exact: true });
const revealRail = async () => {
  if (!(await page.locator(".db-rail").isVisible()))
    await page.locator(".rail-reveal-edge").hover();
  await expect(page.locator(".db-rail")).toBeVisible();
};
const chooseTheme = async (name) =>
  panel().getByRole("radio", { name, exact: true }).click();
try {
  await page.waitForSelector(".cm-content");
  const editor = page.locator(".cm-content");
  await editor.fill("SELECT 42 AS preserved_draft;");
  await revealRail();
  const settingsBox = await settings().boundingBox();
  const quitBox = await page
    .getByRole("button", { name: "Quit Rowfish" })
    .boundingBox();
  const workspaceBox = await page.locator(".db-workspace").boundingBox();
  expect(settingsBox.x).toBeGreaterThanOrEqual(workspaceBox.x);
  expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(
    workspaceBox.x + workspaceBox.width,
  );
  expect(settingsBox.y).toBeGreaterThan(
    workspaceBox.y + workspaceBox.height - 70,
  );
  expect(quitBox.x).toBeGreaterThan(settingsBox.x);
  expect(quitBox.y).toBe(settingsBox.y);
  await settings().click();
  await expect(panel()).toBeVisible();
  await expect(editor).not.toBeVisible();
  for (const [name, id] of [
    ["AMOLED black", "amoled"],
    ["Deep", "deep"],
    ["Forest", "forest"],
    ["Plum", "plum"],
    ["Paper", "paper"],
    ["Glass", "glass"],
  ]) {
    await chooseTheme(name);
    await expect(page.locator("html")).toHaveAttribute("data-appearance", id);
    await expect(panel()).toBeVisible();
  }
  await panel().getByRole("radio", { name: "Custom", exact: true }).click();
  await panel().getByLabel("Custom accent color").fill("#1263bb");
  await expect(page.locator("html")).toHaveCSS("--mint", "#1263bb");
  await panel().getByRole("radio", { name: "Compact", exact: true }).click();
  await panel()
    .getByLabel("Interface font", { exact: true })
    .selectOption("Georgia");
  await panel().getByLabel("Background blur", { exact: true }).uncheck();
  await panel().getByRole("radio", { name: "Reduced", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-blur", "false");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await panel().getByRole("button", { name: "Editor", exact: true }).click();
  await panel()
    .getByLabel("Editor font", { exact: true })
    .selectOption("Courier New");
  await panel().getByLabel("Editor font size", { exact: true }).fill("18");
  await panel().getByLabel("Line numbers", { exact: true }).uncheck();
  await panel().getByLabel("Line wrapping", { exact: true }).check();
  await panel().getByRole("button", { name: "Back", exact: false }).click();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("preserved_draft");
  await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "18px");
  await expect(page.locator(".cm-lineNumbers")).toHaveCSS("display", "none");
  await expect(editor).toHaveClass(/cm-lineWrapping/);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-text-density",
    "compact",
  );
  await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "18px");
  await expect(editor).toContainText("preserved_draft");
  await page.keyboard.press("Control+,");
  await expect(panel()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel()).not.toBeVisible();
  await expect(settings()).toBeFocused();
  await settings().click();
  await panel().getByRole("button", { name: "Restore defaults" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance",
    "glass",
  );
  await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "14px");
  await page.screenshot({
    path: join(artifacts, "rowfish-settings-glass.png"),
  });
  await chooseTheme("Paper");
  await page.screenshot({
    path: join(artifacts, "rowfish-settings-paper.png"),
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 640),
  );
  for (const target of [
    settings(),
    page.getByRole("button", { name: "Quit Rowfish" }),
    panel().getByRole("button", { name: "Back", exact: false }),
  ]) {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1000);
  }
  await page.screenshot({
    path: join(artifacts, "rowfish-settings-minimum.png"),
  });
  await panel().getByRole("button", { name: "Back", exact: false }).click();
  const sidebarToggle = page.locator(".sidebar-toggle");
  await expect(sidebarToggle).toHaveAccessibleName(
    /^(Open|Close) explorer sidebar$/,
  );
  // Back leaves the rail peeked over the toggle; Escape tucks it away.
  if (await page.locator(".db-rail").isVisible())
    await page.keyboard.press("Escape");
  await expect(page.locator(".db-rail")).not.toBeVisible();
  // A collapsed explorer peeks out from the left edge, footer and all.
  await revealRail();
  await expect(settings()).toBeVisible();
  await settings().click();
  await expect(panel()).toBeVisible();
  await expect(editor).not.toBeVisible();
  expect(errors).toEqual([]);
  // Exercise the same unsaved-row beforeunload path used by the workspace.
  await page.evaluate(() =>
    window.addEventListener("beforeunload", (event) => {
      event.preventDefault();
      event.returnValue = "";
    }),
  );
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0;
  });
  await page.getByRole("button", { name: "Quit Rowfish" }).click();
  await expect(panel()).toBeVisible();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
  });
  const closed = app.waitForEvent("close");
  await page.getByRole("button", { name: "Quit Rowfish" }).click();
  await closed;
  console.log(
    "PASS sidebar placement, six themes, custom accent, UI/editor preferences, persistence, draft preservation, keyboard, minimum window, collapsed access, quit",
  );
} catch (error) {
  await page
    .screenshot({ path: join(artifacts, "settings-smoke-failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close().catch(() => {});
}
