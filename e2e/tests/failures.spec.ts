import { expect, rail, test } from "./fixtures";

// What the window does when the core says no: each test makes the fake
// core refuse something (`?fail=`, `?configerror`, see e2e/app/backend.ts)
// and checks the user is told, and that nothing is shown as done that
// was not.

test("a broken config file is named in a banner", async ({ app }) => {
  const page = await app("configerror");
  await expect(page.getByText("recurring.yml line 3: e2e: unknown field `cronn`")).toBeVisible();
});

test("a refused status change is rolled back and said", async ({ app }) => {
  const page = await app("fail=task_update:db");
  const plan = page.locator(".group", { has: page.getByText("Plan the week", { exact: true }) }).last();
  await plan.getByTitle(/^Status: To Do/).click();
  await expect(page.getByText("e2e: task_update refused (db)")).toBeVisible();
  await expect(plan.getByTitle(/^Status: To Do/)).toBeVisible();
});

test("a wiped remote offers to upload the vault again, and that goes through", async ({ app }) => {
  const page = await app("signedin&fail=sync_now:remote_wiped");
  await rail(page, "Settings").click();
  await page.getByRole("main").getByRole("button", { name: "Sync", exact: true }).click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText(/Most of what this device had synced is gone/)).toBeVisible();

  await page.getByRole("button", { name: "Upload this vault again" }).click();

  await expect(page.getByText(/2 in, 1 out/)).toBeVisible();
  await expect(page.getByText(/Most of what this device had synced is gone/)).toHaveCount(0);
  const resets = await page.evaluate(
    () =>
      (window as unknown as { __e2eCalls: { cmd: string }[] }).__e2eCalls.filter(
        (c) => c.cmd === "sync_reset_space",
      ).length,
  );
  expect(resets).toBe(1);
});

test("a refused quick add keeps what was typed", async ({ app }) => {
  const page = await app("fail=task_create:db");
  await page.getByRole("button", { name: "+ Add task" }).first().click();
  const field = page.getByPlaceholder("Task title, or {Category} title");
  await field.fill("Call the bank");
  await page.keyboard.press("Enter");
  await expect(page.getByText("e2e: task_create refused (db)")).toBeVisible();
  await expect(field).toHaveValue("Call the bank");
});

test("a journal entry whose save keeps failing is not left for another day", async ({ app }) => {
  const page = await app("fail=journal_save:io:2");
  await rail(page, "Journal").click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("Not lost.");
  await expect(page.getByText("e2e: journal_save refused (io)").first()).toBeVisible();
  // the switch tries the save again, it fails again: the entry stays
  await page.getByTitle("Previous day (Alt+←)").click();
  await expect(page.locator(".cm-content")).toContainText("Not lost.");
  await expect(page.locator(".cm-content")).not.toContainText("Shipped the first public build.");

  // the third try goes through, and then the day changes
  await page.getByTitle("Previous day (Alt+←)").click();
  await expect(page.locator(".cm-content")).toContainText("Shipped the first public build.");
  await page.getByTitle("Next day (Alt+→)").click();
  await expect(page.locator(".cm-content")).toContainText("Not lost.");
});

test("a note whose save keeps failing is not left for another note", async ({ app }) => {
  const page = await app("fail=kb_write:io:2");
  await rail(page, "Notes").click();
  await page.getByRole("button", { name: "Welcome.md" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Not lost.");
  await expect(page.getByText("e2e: kb_write refused (io)").first()).toBeVisible();
  // opening another note tries the save again, it fails again: the
  // editor stays on the unsaved note
  await page.getByRole("button", { name: "Ideas.md" }).click();
  await expect(page.locator(".cm-content")).toContainText("Not lost.");
  await expect(page.locator(".cm-content")).not.toContainText("a calmer weekly review");

  // the third try goes through, and then the other note opens
  await page.getByRole("button", { name: "Ideas.md" }).click();
  await expect(page.locator(".cm-content")).toContainText("a calmer weekly review");
  await page.getByRole("button", { name: "Welcome.md" }).click();
  await expect(page.locator(".cm-content")).toContainText("Not lost.");
});
