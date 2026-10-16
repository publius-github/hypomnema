import type { Page } from "@playwright/test";
import { expect, rail, test } from "./fixtures";

// Pixel baselines of every screen, for checking that a styling or
// dependency change (a Tailwind upgrade, say) moved nothing it should
// not have. Baselines are per machine and not committed: make them on
// the base commit with `npm run e2e:visual -- --update-snapshots`, then
// run `npm run e2e:visual` after the change.

const SECTIONS = [
  "Dashboard",
  "Lists",
  "Days",
  "Upcoming",
  "Reminders",
  "Calendar",
  "History",
  "Review",
  "Journal",
  "Notes",
];
const SETTINGS_TABS = ["General", "Tasks", "Recurring & calendar", "Capture & alerts", "Data", "Sync"];

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // no caret blink or hover state in the picture
  await page.mouse.move(0, 0);
}

for (const theme of ["dark", "light"]) {
  test.describe(`${theme} theme`, () => {
    for (const label of SECTIONS) {
      test(label, async ({ app }) => {
        const page = await app(`theme=${theme}`);
        await expect(page.getByText("Plan the week").first()).toBeVisible();
        await rail(page, label).click();
        await settle(page);
        await expect(page).toHaveScreenshot(`${theme}-${label}.png`, { fullPage: true });
      });
    }

    for (const tab of SETTINGS_TABS) {
      test(`Settings ${tab}`, async ({ app }) => {
        const page = await app(`theme=${theme}`);
        await rail(page, "Settings").click();
        await page.getByRole("button", { name: tab, exact: true }).last().click();
        await settle(page);
        await expect(page).toHaveScreenshot(`${theme}-settings-${tab.replace(/\W+/g, "-")}.png`, {
          fullPage: true,
        });
      });
    }

    test("task dialog", async ({ app }) => {
      const page = await app(`theme=${theme}`);
      await page.getByText("Plan the week", { exact: true }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`${theme}-task-dialog.png`);
    });

    test("vault picker", async ({ app }) => {
      const page = await app(`theme=${theme}&novault&empty`);
      await settle(page);
      await expect(page).toHaveScreenshot(`${theme}-vault-picker.png`);
    });
  });
}

test.describe("phone", () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  for (const tab of ["Day", "Lists", "Journal", "Notes", "More"]) {
    test(tab, async ({ app }) => {
      const page = await app("mobile");
      await page.getByRole("button", { name: tab, exact: true }).last().click();
      await settle(page);
      await expect(page).toHaveScreenshot(`phone-${tab}.png`);
    });
  }
});
