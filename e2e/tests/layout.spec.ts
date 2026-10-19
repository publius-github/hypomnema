import type { Page } from "@playwright/test";
import { expect, rail, test } from "./fixtures";

// The window at the sizes it really opens at: 1280x800 is the default,
// 900x600 the smallest tauri.conf.json allows. And text at the sizes
// Settings > Base font size (and Ctrl+= / Ctrl+-) reach.

async function railButtonInView(page: Page, label: string) {
  const box = await rail(page, label).boundingBox();
  const height = page.viewportSize()!.height;
  return !!box && box.y >= 0 && box.y + box.height <= height;
}

test("every rail button is in view at the default window size", async ({ app, page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await app();
  for (const label of ["Dashboard", "Notes", "Search", "Sync", "About", "Settings"]) {
    expect(await railButtonInView(page, label), label).toBe(true);
  }
});

test("the smallest window still reaches Settings from the rail", async ({ app, page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await app();
  const settings = rail(page, "Settings");
  await settings.scrollIntoViewIfNeeded();
  await settings.click();
  await expect(settings).toHaveAttribute("aria-current", "page");
  // a rail button reached with Tab is scrolled into view, not left
  // focused under the window's edge
  await settings.focus();
  expect(await railButtonInView(page, "Settings")).toBe(true);
});

test("task titles in the day columns stay readable by default", async ({ app, page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await app();
  const widths = await page.locator('[aria-roledescription="task"] .truncate').evaluateAll((els) =>
    els.map((el) => [el.textContent, Math.round(el.getBoundingClientRect().width)] as const),
  );
  // a 200px day column with a time, a subtask count or an Overdue chip
  // beside the title: the start of the title has to show (it was cut
  // to nothing while the hover-only buttons kept their width)
  const checked = widths.filter(([t]) => t === "Plan the week" || t?.includes("Renew"));
  expect(checked).toHaveLength(2);
  for (const [title, width] of checked) {
    expect(width, `${title}`).toBeGreaterThanOrEqual(48);
  }
  // hovering brings the action buttons into the row; the title keeps
  // its floor instead of being squeezed out (it went to zero width on
  // a Linux font, where the click then never reached it)
  const plan = page.getByRole("group", { name: "Plan the week" });
  await plan.hover();
  const hovered = await plan
    .locator(".truncate")
    .first()
    .evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(hovered).toBeGreaterThanOrEqual(48);
});

test("the week's phrase never covers the header controls", async ({ app, page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await app();
  const phrase = await page.getByRole("button", { name: "Ship the open-source release" }).boundingBox();
  expect(phrase).not.toBeNull();
  for (const name of ["Lists", "Groups", "Days"]) {
    // the whole labelled control: its caption and its dropdown
    const control = await page
      .locator("label")
      .filter({ has: page.locator("select"), hasText: new RegExp(`^${name}`) })
      .boundingBox();
    expect(control).not.toBeNull();
    const overlaps =
      phrase!.x < control!.x + control!.width && control!.x < phrase!.x + phrase!.width;
    expect(overlaps, name).toBe(false);
  }
});

test("Ctrl+= and Ctrl+0 step the text size", async ({ app }) => {
  const page = await app();
  const rootSize = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(await rootSize()).toBe("16px");
  await page.keyboard.press("Control+Equal");
  await page.keyboard.press("Control+Equal");
  await expect.poll(rootSize).toBe("18px");
  await page.keyboard.press("Control+Minus");
  await expect.poll(rootSize).toBe("17px");
  await page.keyboard.press("Control+Digit0");
  await expect.poll(rootSize).toBe("16px");
});

test("a larger base font size enlarges the small print too", async ({ app }) => {
  const page = await app();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
  });
  for (const label of ["Dashboard", "Upcoming", "Calendar", "Review", "Settings"]) {
    await rail(page, label).click();
    // the rail is fixed-size chrome (TabBar.tsx); everything else
    // derives from the root size, so nothing visible stays below 14px
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll("main *"))
        .filter((el) => {
          const own = Array.from(el.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim(),
          );
          const box = el.getBoundingClientRect();
          return own && box.width > 0 && parseFloat(getComputedStyle(el).fontSize) < 14;
        })
        .map((el) => `${el.tagName} ${getComputedStyle(el).fontSize} "${el.textContent!.trim().slice(0, 30)}"`),
    );
    expect(small, label).toEqual([]);
  }
});
