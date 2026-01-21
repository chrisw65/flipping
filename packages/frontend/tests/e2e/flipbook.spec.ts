import { test, expect } from "@playwright/test";

test("loads flipbook canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
});
