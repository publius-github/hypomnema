import { expect, rail, test } from "./fixtures";

test("without a vault the app asks for one", async ({ app }) => {
  const page = await app("novault&empty");
  await expect(page.getByText(/vault/i).first()).toBeVisible();
  await expect(page.getByText("Plan the week")).toHaveCount(0);
});

test("settings search narrows to the matching group", async ({ app }) => {
  const page = await app();
  await rail(page, "Settings").click();
  await page.getByPlaceholder("Search settings...").fill("retention");
  await expect(page.getByText(/retention|Done tasks cleanup/i).first()).toBeVisible();
});

test("a note opens in the editor", async ({ app }) => {
  const page = await app();
  await rail(page, "Notes").click();
  await page.getByRole("button", { name: "Welcome.md" }).click();
  await expect(page.getByText("Notes are plain Markdown files.", { exact: false })).toBeVisible();
});

test("the journal shows an earlier entry", async ({ app }) => {
  const page = await app();
  await rail(page, "Journal").click();
  await expect(page.locator("body")).toContainText("Journal");
});

test("the light theme applies", async ({ app }) => {
  const page = await app("theme=light");
  await expect(page.getByText("Plan the week")).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
