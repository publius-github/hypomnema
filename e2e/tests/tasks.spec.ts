import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** The card of a task, by its exact title. */
function card(page: Page, title: string) {
  return page.locator(".group", { has: page.getByText(title, { exact: true }) }).last();
}

/** The commands the page sent to the core, from the fake backend's log. */
async function commands(page: Page, name: string) {
  return page.evaluate(
    (cmd) =>
      (window as unknown as { __e2eCalls: { cmd: string; args: unknown }[] }).__e2eCalls
        .filter((c) => c.cmd === cmd)
        .map((c) => c.args),
    name,
  );
}

test("a task added under today's column lands there", async ({ app }) => {
  const page = await app();
  await page.getByRole("button", { name: "+ Add task" }).first().click();
  await page.getByPlaceholder("Task title, or {Category} title").fill("Call the bank");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Call the bank", { exact: true }).first()).toBeVisible();
  const created = await commands(page, "task_create");
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ new: { title: "Call the bank" } });
});

test("clicking the status box completes a task", async ({ app }) => {
  const page = await app();
  const plan = card(page, "Plan the week");
  await plan.getByTitle(/^Status: To Do/).click();
  await expect.poll(() => commands(page, "task_update")).toContainEqual(
    expect.objectContaining({ patch: expect.objectContaining({ status: "done" }) }),
  );
});

test("a deleted task comes back with Undo", async ({ app }) => {
  const page = await app();
  const plan = card(page, "Plan the week");
  await plan.hover();
  await plan.getByTitle("Delete task").click();
  await expect(page.getByText("Plan the week", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Plan the week", { exact: true })).toBeVisible();
});

test("opening a task shows its editor", async ({ app }) => {
  const page = await app();
  await page.getByText("Plan the week", { exact: true }).click();
  await expect(page.locator('input[value="Plan the week"], textarea').first()).toBeVisible();
});

test("search finds a task from anywhere", async ({ app }) => {
  const page = await app();
  await expect(page.getByText("Plan the week")).toBeVisible();
  await page.keyboard.press("Control+KeyK");
  await page.getByPlaceholder("Search tasks, notes and journal...").fill("leaking");
  await expect(page.getByText("Fix the leaking tap").last()).toBeVisible();
});
