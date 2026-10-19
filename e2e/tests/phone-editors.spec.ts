import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The phone's Journal and Notes are plain textareas on the same autosave
// hook as the desktop editors (editors.spec, failures.spec); these cover
// the same contract through the phone's own screens.

const PHONE = { width: 412, height: 915 };

function tab(page: Page, label: string) {
  return page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: label, exact: true });
}

async function saves(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __e2eCalls: { cmd: string; args: unknown }[] }).__e2eCalls
        .filter((c) => c.cmd === "journal_save")
        .map((c) => c.args as { date: string; content: string }),
  );
}

test("phone journal typing is saved once it pauses", async ({ app, page }) => {
  await page.setViewportSize(PHONE);
  await app("mobile");
  await tab(page, "Journal").click();
  const entry = page.getByPlaceholder("Write about today...");
  await entry.click();
  await page.keyboard.type("A quiet morning.");
  await expect
    .poll(async () => (await saves(page)).at(-1))
    .toEqual({ date: "2026-10-14", content: expect.stringContaining("A quiet morning."), base: expect.anything() });
});

test("phone: switching days saves the typing still waiting and brings it back", async ({ app, page }) => {
  await page.setViewportSize(PHONE);
  await app("mobile");
  await tab(page, "Journal").click();
  const entry = page.getByPlaceholder("Write about today...");
  await entry.click();
  await page.keyboard.type("Before the switch.");
  // no pause: the day switch itself must save it
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(entry).toHaveValue(/Shipped the first public build\./);
  expect((await saves(page)).some((s) => s.content.includes("Before the switch."))).toBe(true);

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(entry).toHaveValue(/Before the switch\./);
});

test("phone: a journal entry whose save keeps failing is not left for another day", async ({ app, page }) => {
  await page.setViewportSize(PHONE);
  await app("mobile&fail=journal_save:io:2");
  await tab(page, "Journal").click();
  const entry = page.getByPlaceholder("Write about today...");
  await entry.click();
  await page.keyboard.type("Not lost.");
  await expect(page.getByText("e2e: journal_save refused (io)").first()).toBeVisible();
  // the switch tries the save again, it fails again: the entry stays
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(entry).toHaveValue(/Not lost\./);
  await expect(entry).not.toHaveValue(/Shipped the first public build\./);

  // the third try goes through, and then the day changes
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(entry).toHaveValue(/Shipped the first public build\./);
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(entry).toHaveValue(/Not lost\./);
});

test("phone: a note whose save keeps failing is not left for another note", async ({ app, page }) => {
  await page.setViewportSize(PHONE);
  await app("mobile&fail=kb_write:io:2");
  await tab(page, "Notes").click();
  await page.getByRole("button", { name: "Welcome.md" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator("textarea");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Not lost.");
  await expect(page.getByText("e2e: kb_write refused (io)").first()).toBeVisible();
  // leaving tries the save again, it fails again: the editor stays open
  await page.getByRole("button", { name: "‹ Back" }).click();
  await expect(editor).toHaveValue(/Not lost\./);

  // the third try goes through, and then the list is back
  await page.getByRole("button", { name: "‹ Back" }).click();
  await expect(page.getByRole("button", { name: "Welcome.md" })).toBeVisible();
  await page.getByRole("button", { name: "Welcome.md" }).click();
  await expect(page.getByText("Not lost.")).toBeVisible();
});
