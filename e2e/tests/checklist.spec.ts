import type { Page } from "@playwright/test";
import { expect, rail, test } from "./fixtures";

/** The list column whose header names the list. */
function column(page: Page, name: string) {
  return page
    .locator("div.rounded-lg.border", { has: page.getByRole("heading", { name }) })
    .last();
}

test("a checklist is ticked off, reset for the next round, and the reset undone", async ({
  app,
}, testInfo) => {
  const page = await app();
  // checklists have a page of their own, and its New makes a checklist
  await rail(page, "Checklists").click();
  await page.getByRole("button", { name: "+ New checklist" }).click();
  await page.getByPlaceholder("Checklist name").fill("Trip");
  await page.keyboard.press("Enter");
  const trip = column(page, "Trip");
  // the header says what kind of list it is
  await expect(trip.getByText("Checklist", { exact: true })).toBeVisible();

  // the add field stays open after Enter, for the next item
  await trip.getByRole("button", { name: "+ Add task" }).click();
  for (const item of ["Passport", "Charger", "Toothbrush"]) {
    await page.getByPlaceholder("Task title, or {Category} title").fill(item);
    await page.keyboard.press("Enter");
    await expect(trip.getByText(item, { exact: true })).toBeVisible();
  }
  await expect(trip.getByText("0/3")).toBeVisible();

  for (const item of ["Passport", "Charger"]) {
    await trip
      .locator(".group", { has: page.getByText(item, { exact: true }) })
      .last()
      .getByTitle(/^Status: To Do/)
      .click();
  }
  await expect(trip.getByText("2/3")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("checklist-desktop.png") });

  // what is left to pack
  await trip.getByRole("button", { name: "Hide checked items" }).click();
  await expect(trip.getByText("Passport", { exact: true })).toHaveCount(0);
  await expect(trip.getByText("Toothbrush", { exact: true })).toBeVisible();
  await trip.getByRole("button", { name: "Show checked items" }).click();

  await trip.getByRole("button", { name: "Uncheck all" }).click();
  await expect(trip.getByText("0/3")).toBeVisible();
  await expect(page.getByText('Unchecked 2 items in "Trip"')).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(trip.getByText("2/3")).toBeVisible();
});

test("a list switched to a checklist leaves Lists and the dashboard for Checklists", async ({ app }) => {
  const page = await app();
  await rail(page, "Lists").click();
  // a new list is a todo list; the type is switched in its settings
  await page.getByRole("button", { name: "+ New list" }).click();
  await page.getByPlaceholder("List name").fill("Errands");
  await page.keyboard.press("Enter");
  const errands = column(page, "Errands");
  await expect(errands.getByText("Checklist", { exact: true })).toHaveCount(0);
  await errands.getByRole("button", { name: /^List settings/ }).click();
  await page.locator("select", { has: page.locator("option", { hasText: "Checklist" }) }).selectOption("checklist");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Errands" })).toHaveCount(0);

  await rail(page, "Dashboard").click();
  await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Errands" })).toHaveCount(0);

  await rail(page, "Checklists").click();
  await expect(column(page, "Errands").getByText("Checklist", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Work" })).toHaveCount(0);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test("a ~ group sits under every list on the phone", async ({ app }) => {
    const page = await app("mobile");
    await page.getByRole("button", { name: "Lists", exact: true }).last().click();
    await page.getByRole("button", { name: "Group", exact: true }).click();
    await page.getByPlaceholder("New group").fill("~checklists");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const rows = page.getByRole("listitem");
    await expect(rows.last()).toContainText("~checklists");
  });

  test("one task's subtasks start over from its open subtask list", async ({ app }) => {
    const page = await app("mobile");
    await page.getByRole("button", { name: /Subtasks/ }).first().click();
    await page.getByRole("button", { name: /Draft the agenda/ }).first().click();
    await page.getByRole("button", { name: "Uncheck all" }).click();
    await expect(page.getByText('Unchecked 1 subtask of "Plan the week"')).toBeVisible();
    await expect(page.getByRole("button", { name: "Uncheck all" })).toHaveCount(0);
  });

  test("an empty group is deleted from its own screen", async ({ app }) => {
    const page = await app("mobile");
    await page.getByRole("button", { name: "Lists", exact: true }).last().click();
    await page.getByRole("button", { name: "Group", exact: true }).click();
    await page.getByPlaceholder("New group").fill("_checklists");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Open group _checklists" }).click();
    await page.getByRole("button", { name: "Delete this group" }).click();
    await expect(page.getByText("_checklists")).toHaveCount(0);
  });

  test("a list switched to a checklist on the phone says so and shows its progress", async ({ app }, testInfo) => {
    const page = await app("mobile");
    await page.getByRole("button", { name: "Lists", exact: true }).last().click();
    await page.getByPlaceholder("New list").fill("Trip");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByText("Trip", { exact: true }).click();
    await page.getByRole("button", { name: "List settings" }).click();
    await page.locator("select", { has: page.locator("option", { hasText: "Checklist" }) }).selectOption("checklist");
    await page.getByRole("button", { name: "List settings" }).click();
    await expect(page.getByText("Checklist", { exact: true })).toBeVisible();
    for (const item of ["Passport", "Charger"]) {
      await page.getByPlaceholder("New task in Trip").fill(item);
      await page.getByRole("button", { name: "Add", exact: true }).click();
    }
    await expect(page.getByText("0/2")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("checklist-phone.png") });
    // it moved to the Checklists side of the screen
    await page.getByRole("button", { name: "‹ Lists" }).click();
    await expect(page.getByText("Trip", { exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Checklists" }).click();
    await expect(page.getByRole("img", { name: "Checklist" })).toBeVisible();
    await expect(page.getByText("Trip", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("checklist-phone-index.png") });
  });

  test("the Checklists side of the phone's list screen makes checklists", async ({ app }) => {
    const page = await app("mobile");
    await page.getByRole("button", { name: "Lists", exact: true }).last().click();
    await page.getByRole("tab", { name: "Checklists" }).click();
    await page.getByPlaceholder("New checklist").fill("Gym bag");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("img", { name: "Checklist" })).toBeVisible();
    await page.getByRole("tab", { name: "Lists", exact: true }).click();
    await expect(page.getByText("Gym bag", { exact: true })).toHaveCount(0);
  });
});

test("an empty group on a flat panel is reached from the index and deleted", async ({ app }) => {
  const page = await app();
  await rail(page, "Lists").click();
  // a narrow panel, so the All lists index shows
  await page.getByRole("combobox", { name: "Lists" }).selectOption("2");
  await page.getByRole("button", { name: "+ New group" }).click();
  await page.getByPlaceholder("Group name").fill("_checklists");
  await page.keyboard.press("Enter");

  const row = page.getByRole("button", { name: "_checklists" });
  await expect(row).toBeVisible();
  await row.click({ button: "right" });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Delete group" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
});

test("a group's dialog offers only its page's kind of list", async ({ app }) => {
  const page = await app();
  await rail(page, "Lists").click();
  // a narrow panel, so the All lists index shows
  await page.getByRole("combobox", { name: "Lists" }).selectOption("2");
  await page.getByRole("button", { name: "+ New group" }).click();
  await page.getByPlaceholder("Group name").fill("_mixed");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "_mixed" }).click({ button: "right" });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Lists in this group")).toBeVisible();
  await expect(dialog.getByText("Work", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // the empty group shows on Checklists too, where no todo list is offered
  await rail(page, "Checklists").click();
  await page.getByRole("button", { name: "+ New checklist" }).click();
  await page.getByPlaceholder("Checklist name").fill("Packing");
  await page.keyboard.press("Enter");
  await page.getByRole("combobox", { name: "Checklists" }).selectOption("1");
  await page.getByRole("button", { name: "_mixed" }).click({ button: "right" });
  await expect(dialog.getByText("Checklists in this group")).toBeVisible();
  await expect(dialog.getByText("Packing", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Work", { exact: true })).toHaveCount(0);
});

test("one task's subtasks start over on their own, with Undo", async ({ app }) => {
  const page = await app();
  const plan = page.locator(".group", { has: page.getByText("Plan the week", { exact: true }) }).first();
  // nothing checked yet: no reset to offer
  await expect(plan.getByRole("button", { name: "Uncheck the subtasks of Plan the week" })).toHaveCount(0);
  await plan.getByRole("button", { name: /^▸/ }).click();
  await plan.getByText("Draft the agenda", { exact: true }).locator("xpath=..").getByRole("checkbox").click();
  const reset = plan.getByRole("button", { name: "Uncheck the subtasks of Plan the week" });
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(page.getByText('Unchecked 1 subtask of "Plan the week"')).toBeVisible();
  await expect(reset).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(reset).toBeVisible();
});
