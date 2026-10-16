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

test("the welcome screen opens an example vault", async ({ app }) => {
  const page = await app("novault&pick=C:%5CUsers%5Ce2e%5CExample");
  await page.getByRole("button", { name: "Try it with an example" }).click();
  await expect(page.getByText("Plan the week").first()).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as unknown as { __e2eCalls: { cmd: string; args: { path?: string } }[] }).__e2eCalls.filter(
      (c) => c.cmd === "vault_create_example",
    ),
  );
  expect(calls).toEqual([{ cmd: "vault_create_example", args: { path: "C:\\Users\\e2e\\Example" } }]);
});

test("advanced settings stay off the page until asked for", async ({ app }) => {
  const page = await app();
  await rail(page, "Settings").click();
  const tabs = page.locator("button[aria-current], button").filter({ hasText: "Recurring & calendar" });
  await expect(tabs).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Show advanced settings" }).check();
  await page.getByRole("button", { name: "Recurring & calendar", exact: true }).click();
  await expect(page.getByText("Cadence buckets").first()).toBeVisible();
});

test("a search still reaches an advanced setting", async ({ app }) => {
  const page = await app();
  await rail(page, "Settings").click();
  await page.getByPlaceholder("Search settings...").fill("catch-up");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Recurring catch-up window, days")).toBeVisible();
});
