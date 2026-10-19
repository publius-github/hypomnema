import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, rail, test } from "./fixtures";

// axe-core over every screen, against WCAG 2 A and AA plus axe's best
// practices (landmarks, one top heading per page). A rule switched off
// here needs its reason written next to it.

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
  "Settings",
];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  return result.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
}

for (const theme of ["dark", "light"]) {
  for (const label of SECTIONS) {
    test(`${theme} ${label}`, async ({ app }) => {
      const page = await app(`theme=${theme}`);
      await expect(page.getByText("Plan the week").first()).toBeVisible();
      await rail(page, label).click();
      expect(await violations(page)).toEqual([]);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
    });
  }
}

test("task dialog", async ({ app }) => {
  const page = await app();
  // the keyboard path: the mouse path is tasks.spec's "opening a task"
  await page.getByRole("group", { name: "Plan the week" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Task" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("phone", async ({ app, page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await app("mobile");
  await expect(page.getByText("Plan the week").first()).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
