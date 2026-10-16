import { expect, rail, test } from "./fixtures";

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

test("boots into the dashboard with today's tasks", async ({ app }) => {
  const page = await app();
  await expect(page.getByText("Plan the week")).toBeVisible();
  await expect(page.getByText("Ship the open-source release").first()).toBeVisible();
});

test("every section opens without an error", async ({ app }) => {
  const page = await app();
  await expect(page.getByText("Plan the week")).toBeVisible();
  for (const label of SECTIONS) {
    await rail(page, label).click();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  }
});
