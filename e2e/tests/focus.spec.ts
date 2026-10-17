import type { Locator, Page } from "@playwright/test";
import { expect, rail, test } from "./fixtures";

// Where keyboard focus goes - into a dialog, around it, back out of it,
// and after the thing it was on is gone - and what a screen reader is
// told along the way.

/** Marks `el` so the test can ask later whether focus came back to it. */
async function mark(el: Locator) {
  await el.evaluate((node) => node.setAttribute("data-e2e-opener", ""));
}

async function focusInDialog(page: Page) {
  return page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
}

async function focusOnOpener(page: Page) {
  return page.evaluate(() => document.activeElement?.hasAttribute("data-e2e-opener") ?? false);
}

/** Focus is in the open dialog and Tab / Shift+Tab never leave it. */
async function expectFocusHeld(page: Page) {
  expect(await focusInDialog(page)).toBe(true);
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press(key);
      expect(await focusInDialog(page), `${key} #${i + 1} left the dialog`).toBe(true);
    }
  }
}

test("the task dialog takes focus, keeps it and gives it back to the card", async ({ app }) => {
  const page = await app();
  const card = page.getByRole("group", { name: "Plan the week" });
  await mark(card);
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Task" })).toBeVisible();
  await expectFocusHeld(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Task" })).toHaveCount(0);
  expect(await focusOnOpener(page)).toBe(true);
});

const DIALOGS: { name: string; open: (page: Page) => Locator }[] = [
  {
    name: "List",
    open: (page) => page.getByRole("button", { name: "List settings: tasks, color, description" }).first(),
  },
  { name: "Quick add", open: (page) => page.getByRole("button", { name: "+ Task" }) },
  { name: "About Hypomnema", open: (page) => rail(page, "About") },
  { name: "Archive list?", open: (page) => page.getByRole("button", { name: "Archive list" }).first() },
];

for (const { name, open } of DIALOGS) {
  test(`the ${name} dialog holds focus and returns it`, async ({ app }) => {
    const page = await app();
    await expect(page.getByText("Plan the week").first()).toBeVisible();
    const opener = open(page);
    await mark(opener);
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expectFocusHeld(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await focusOnOpener(page)).toBe(true);
  });
}

test("the search palette keeps Tab inside and returns focus", async ({ app }) => {
  const page = await app();
  const opener = rail(page, "Calendar");
  await mark(opener);
  await opener.focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  await expectFocusHeld(page);
  await page.keyboard.press("Escape");
  expect(await focusOnOpener(page)).toBe(true);
});

test("deleting a task from its card puts focus on Undo", async ({ app }) => {
  const page = await app();
  const card = page.getByRole("group", { name: "Plan the week" });
  await card.focus();
  // Tab walks into the card's own buttons; the delete one is last
  const remove = card.getByRole("button", { name: "Delete task" });
  await remove.focus();
  await page.keyboard.press("Enter");
  const undo = page.getByRole("status").getByRole("button", { name: "Undo" });
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "Plan the week" })).toBeVisible();
});

test("the card's hidden actions show for the keyboard", async ({ app }) => {
  const page = await app();
  const card = page.getByRole("group", { name: "Plan the week" });
  await expect(card.getByRole("button", { name: "Delete task" })).toBeHidden();
  await card.focus();
  await expect(card.getByRole("button", { name: "Delete task" })).toBeVisible();
});

test("an error is announced as an alert", async ({ app }) => {
  const page = await app("fail=task_update:db");
  const plan = page.getByRole("group", { name: "Plan the week" });
  await plan.getByTitle(/^Status: To Do/).click();
  await expect(page.getByRole("alert")).toContainText("e2e: task_update refused (db)");
});

test("a broken config file is announced as a status", async ({ app }) => {
  const page = await app("configerror");
  await expect(page.getByRole("status").filter({ hasText: "recurring.yml line 3" })).toBeVisible();
});

test("picking a card up is announced by its title, not its id", async ({ app }) => {
  const page = await app();
  await page.getByRole("group", { name: "Plan the week" }).focus();
  await page.keyboard.press("Space");
  const live = page.locator('[id^="DndLiveRegion"]');
  // the pickup is followed at once by where the card now is
  await expect(live).toContainText('"Plan the week"');
  // the arrows move in steps; nine of them carry it a column over
  // (keyboard.spec.ts drops it there)
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowRight");
  await expect(live).toContainText('Task "Plan the week" is over Thursday 2026-10-15.');
  await expect(live).not.toContainText(/task:|day:/);
  await page.keyboard.press("Escape");
});
