import type { Page } from "@playwright/test";
import { expect, rail, test } from "./fixtures";

async function commands(page: Page, name: string) {
  return page.evaluate(
    (cmd) =>
      (window as unknown as { __e2eCalls: { cmd: string; args: unknown }[] }).__e2eCalls
        .filter((c) => c.cmd === cmd)
        .map((c) => c.args),
    name,
  );
}

test("Enter on a focused task card opens it", async ({ app }) => {
  const page = await app();
  const card = page.getByRole("group", { name: "Plan the week" });
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Task" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Task" })).toHaveCount(0);
});

test("a task card moves to another day with the keyboard", async ({ app }) => {
  const page = await app();
  const card = page.getByRole("group", { name: "Plan the week" });
  await card.focus();
  await page.keyboard.press("Space");
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect
    .poll(async () => (await commands(page, "task_update")) as { patch: { scheduled_date?: string } }[])
    .toContainEqual(expect.objectContaining({ patch: { scheduled_date: "2026-10-15" } }));
});

test("Escape puts a picked-up card back", async ({ app }) => {
  const page = await app();
  await page.getByRole("group", { name: "Plan the week" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  expect(await commands(page, "task_update")).toEqual([]);
});

test("a rule row opens its editor from the keyboard", async ({ app }) => {
  const page = await app();
  await rail(page, "Upcoming").click();
  await page.getByRole("button", { name: "recurring", exact: true }).click();
  await page.getByRole("button", { name: "Daily care" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
});

test("the active section is marked for assistive tech", async ({ app }) => {
  const page = await app();
  await rail(page, "Calendar").click();
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Calendar" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
