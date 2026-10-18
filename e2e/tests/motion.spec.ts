import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The OS accessibility settings the app follows: reduced motion stops
// animations, and in a high-contrast theme (forced colors) a task's
// status still shows, by its outline and mark rather than its fill.

async function spinDuration(page: Page) {
  return page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "animate-spin";
    document.body.append(el);
    const duration = getComputedStyle(el).animationDuration;
    el.remove();
    return duration;
  });
}

test("the spinner spins unless the system asks for reduced motion", async ({ app, page }) => {
  await app();
  expect(await spinDuration(page)).toBe("1s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(parseFloat(await spinDuration(page))).toBeLessThan(0.001);
});

test("a task's status stays visible in a high-contrast theme", async ({ app, page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await app();
  const boxes = page.locator('[aria-roledescription="task"] .status-box');
  expect(await boxes.count()).toBeGreaterThan(0);
  const looks = await boxes.evaluateAll((els) =>
    els.map((el) => {
      const style = getComputedStyle(el);
      return {
        label: el.getAttribute("aria-label") ?? "",
        border: parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none",
        mark: el.querySelector("svg") !== null,
      };
    }),
  );
  for (const look of looks) {
    expect(look.border, look.label).toBe(true);
    // every status but To Do carries its own mark, not only a color
    if (!look.label.startsWith("Status: To Do")) expect(look.mark, look.label).toBe(true);
  }
});
