import { expect, test as base, type Page } from "@playwright/test";

/** A fixed Wednesday morning, so dates, "today" and screenshots hold still. */
export const NOW = new Date("2026-10-14T09:30:00");

/**
 * Opens the app against the fake core. Any uncaught page error or
 * console error fails the test: a crash the error boundary swallowed
 * still has to surface here.
 */
export const test = base.extend<{ app: (query?: string) => Promise<Page> }>({
  app: async ({ page }, use) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console: ${m.text()}`);
    });
    await page.clock.setFixedTime(NOW);
    await use(async (query = "") => {
      await page.goto(query ? `?${query}` : "");
      return page;
    });
    expect(problems, problems.join("\n")).toEqual([]);
  },
});

export { expect };

/** The rail button of a section, by its visible label. */
export function rail(page: Page, label: string) {
  return page.locator("nav, aside, div").getByRole("button", { name: label, exact: true }).first();
}
