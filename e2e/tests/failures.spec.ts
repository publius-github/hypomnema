import { expect, rail, test } from "./fixtures";

// What the window does when the core says no: each test makes the fake
// core refuse something (`?fail=`, `?configerror`, see e2e/app/backend.ts)
// and checks the user is told, and that nothing is shown as done that
// was not.

test("a broken config file is named in a banner", async ({ app }) => {
  const page = await app("configerror");
  await expect(page.getByText("recurring.yml line 3: e2e: unknown field `cronn`")).toBeVisible();
});

test("a refused status change is rolled back and said", async ({ app }) => {
  const page = await app("fail=task_update:db");
  const plan = page.locator(".group", { has: page.getByText("Plan the week", { exact: true }) }).last();
  await plan.getByTitle(/^Status: To Do/).click();
  await expect(page.getByText("e2e: task_update refused (db)")).toBeVisible();
  await expect(plan.getByTitle(/^Status: To Do/)).toBeVisible();
});

test("a wiped remote offers to upload the vault again, and that goes through", async ({ app }) => {
  const page = await app("signedin&fail=sync_now:remote_wiped");
  await rail(page, "Settings").click();
  await page.getByRole("main").getByRole("button", { name: "Sync", exact: true }).click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText(/Most of what this device had synced is gone/)).toBeVisible();

  await page.getByRole("button", { name: "Upload this vault again" }).click();

  await expect(page.getByText(/2 in, 1 out/)).toBeVisible();
  await expect(page.getByText(/Most of what this device had synced is gone/)).toHaveCount(0);
  const resets = await page.evaluate(
    () =>
      (window as unknown as { __e2eCalls: { cmd: string }[] }).__e2eCalls.filter(
        (c) => c.cmd === "sync_reset_space",
      ).length,
  );
  expect(resets).toBe(1);
});
