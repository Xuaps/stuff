import { test, expect } from "playwright/test";

test("local mode does not request sync or CDN dependencies", async ({ page }) => {
  const requests = [];
  page.on("request", request => requests.push(request.url()));
  await page.goto("/");
  await page.waitForTimeout(100);
  expect(requests.filter(url => /cdn|yjs|simplewebauthn|localhost:8787/i.test(url))).toEqual([]);
});

test("creates an Inbox to-do and persists it after reload", async ({ page }) => {
  await page.goto("/");
  const title = `Playwright task ${Date.now()}`;
  const input = page.getByRole("textbox", { name: "New To-Do" });
  await input.fill(title);
  await input.press("Enter");
  await expect(page.locator(".task-title", { hasText: title })).toBeVisible();

  await page.reload();
  await expect(page.locator(".task-title", { hasText: title })).toBeVisible();
});
