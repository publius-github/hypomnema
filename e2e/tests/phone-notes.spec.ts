import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The phone's notes browser and reading view: the root groups fold, and
// the read-only CodeMirror follows a [[wiki link]] on a plain tap.

const PHONE = { width: 412, height: 915 };

async function openNotes(page: Page) {
  await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Notes", exact: true }).click();
}

test("phone notes: the vault group is open and the config group folded", async ({ app, page }) => {
  await page.setViewportSize(PHONE);
  await app("mobile");
  await openNotes(page);
  await expect(page.getByRole("button", { name: /Welcome\.md/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "recurring.yml" })).toHaveCount(0);

  await page.getByRole("button", { name: /^Config/ }).click();
  await expect(page.getByRole("button", { name: "recurring.yml" })).toBeVisible();
  await page.getByRole("button", { name: /^Vault notes/ }).click();
  await expect(page.getByRole("button", { name: /Welcome\.md/ })).toHaveCount(0);
});

test("phone notes: a tap on a wiki link in the reading view opens that note", async ({ app, page }) => {
  await page.setViewportSize(PHONE);
  await app("mobile");
  await openNotes(page);
  await page.getByRole("button", { name: /Welcome\.md/ }).click();
  const reader = page.getByRole("textbox", { name: "Welcome.md" });
  await expect(reader).toHaveAttribute("contenteditable", "false");
  await reader.getByText("Ideas").click();
  await expect(page.getByRole("textbox", { name: "Ideas.md" })).toBeVisible();
});

test("phone notes: leaving the tab and coming back keeps the open note", async ({ app, page }) => {
  await page.setViewportSize(PHONE);
  await app("mobile");
  const tabs = page.getByRole("navigation", { name: "Tabs" });
  await openNotes(page);
  await page.getByRole("button", { name: /Welcome\.md/ }).click();
  await expect(page.getByRole("textbox", { name: "Welcome.md" })).toBeVisible();

  await tabs.getByRole("button", { name: "Journal", exact: true }).click();
  await openNotes(page);
  await expect(page.getByRole("textbox", { name: "Welcome.md" })).toBeVisible();
});

test("phone notes: a new note's name field shows the .md it gets", async ({ app, page }) => {
  await page.setViewportSize(PHONE);
  await app("mobile");
  await openNotes(page);
  await page.getByRole("button", { name: "+ Note" }).click();
  const field = page.getByPlaceholder("Note name");
  await field.fill("Packing");
  await expect(page.getByText(".md", { exact: true })).toBeVisible();
  // typed by hand, the extension is not shown twice
  await field.fill("Packing.md");
  await expect(page.getByText(".md", { exact: true })).toHaveCount(0);
  await field.fill("Packing");
  await page.screenshot({ path: test.info().outputPath("phone-new-note.png") });
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("textbox", { name: "Packing.md" })).toBeVisible();
});
