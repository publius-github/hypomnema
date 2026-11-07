import { expect, rail, test } from "./fixtures";

// A content hit opens its note on the match: scrolled into view and
// selected, with the search panel on the query on the desktop.

const PHONE = { width: 412, height: 915 };

test("a content hit in Notes opens the note on the match", async ({ app }) => {
  const page = await app("longnote");
  await rail(page, "Notes").click();
  await page.getByPlaceholder("Search notes").fill("treasure");
  await page.getByRole("button", { name: /Long\.md.*buried treasure/ }).click();

  const line = page.locator(".cm-line", { hasText: "The buried treasure is here." });
  await expect(line).toBeInViewport();
  // the search panel opened on the query, and Enter stays on the one match
  await expect(page.locator(".cm-search input[name=search]")).toHaveValue("treasure");
  await expect(page.locator(".cm-searchMatch").first()).toBeVisible();
});

test("a note hit in the search palette opens the note on the match", async ({ app }) => {
  const page = await app("longnote");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search tasks, notes and journal...").fill("treasure");
  await page.getByRole("button", { name: /Long\.md.*buried treasure/ }).click();

  await expect(
    page.locator(".cm-line", { hasText: "The buried treasure is here." }),
  ).toBeInViewport();
});

test("phone notes: a search hit opens the reading view on the match", async ({ app, page }) => {
  await page.setViewportSize(PHONE);
  await app("mobile&longnote");
  await page
    .getByRole("navigation", { name: "Tabs" })
    .getByRole("button", { name: "Notes", exact: true })
    .click();
  const search = page.getByPlaceholder("Search notes");
  await search.fill("treasure");
  await search.press("Enter");
  await page.getByRole("button", { name: /Long\.md/ }).click();

  await expect(
    page.locator(".cm-line", { hasText: "The buried treasure is here." }),
  ).toBeInViewport();
});
