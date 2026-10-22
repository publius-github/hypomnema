import type { Page } from "@playwright/test";
import { expect, rail, test } from "./fixtures";

async function saves(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __e2eCalls: { cmd: string; args: unknown }[] }).__e2eCalls
        .filter((c) => c.cmd === "journal_save")
        .map((c) => c.args as { date: string; content: string }),
  );
}

test("journal typing is saved once it pauses", async ({ app }) => {
  const page = await app();
  await rail(page, "Journal").click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("A quiet morning.");
  await expect
    .poll(async () => (await saves(page)).at(-1))
    .toEqual({ date: "2026-10-14", content: expect.stringContaining("A quiet morning."), base: expect.anything() });
});

test("switching days saves the typing still waiting and brings it back", async ({ app }) => {
  const page = await app();
  await rail(page, "Journal").click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("Before the switch.");
  // no pause: the day switch itself must save it
  await page.getByTitle("Previous day (Alt+←)").click();
  await expect(page.locator(".cm-content")).toContainText("Shipped the first public build.");
  expect((await saves(page)).some((s) => s.content.includes("Before the switch."))).toBe(true);

  await page.getByTitle("Next day (Alt+→)").click();
  await expect(page.locator(".cm-content")).toContainText("Before the switch.");
});

test("the journal index folds by year and by month", async ({ app }) => {
  const page = await app();
  await rail(page, "Journal").click();
  const fold = (name: RegExp) => page.getByRole("button", { name });
  // today's year and month start unfolded, other months and years folded
  await expect(fold(/^▾ 2026/)).toHaveAttribute("aria-expanded", "true");
  await expect(fold(/^▾ October/)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "2026-10-13" })).toBeVisible();
  await expect(fold(/^▸ September/)).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "2026-09-04" })).toHaveCount(0);
  await expect(fold(/^▸ 2025/)).toHaveAttribute("aria-expanded", "false");
  // a month unfolds on its own row
  await fold(/^▸ September/).click();
  await expect(page.getByRole("button", { name: "2026-09-04" })).toBeVisible();
  // opening an entry of a folded month unfolds it
  await fold(/^▾ October/).click();
  await expect(page.getByRole("button", { name: "2026-10-13" })).toHaveCount(0);
  await page.getByTitle("Previous day (Alt+←)").click();
  await expect(page.getByRole("button", { name: "2026-10-13" })).toBeVisible();
});
