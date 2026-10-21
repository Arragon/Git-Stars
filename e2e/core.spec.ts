// M8-10 core journeys: login, library, note persistence, return context, a11y basics.
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/dev-login");
  expect(res.ok()).toBeTruthy();
}

test("library shows the seeded repository", async ({ page }) => {
  await login(page);
  await page.goto("/library");
  await expect(page.getByText("demo", { exact: false }).first()).toBeVisible();
});

test("note edit survives a reload", async ({ page }) => {
  await login(page);
  await page.goto("/repository/e2e-repo");
  const editor = page.getByLabel("个人备注");
  await expect(editor).toBeVisible();
  await editor.fill("e2e note persisted");
  await editor.blur();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByLabel("个人备注")).toHaveValue("e2e note persisted");
});

test("filter context survives the repository round trip", async ({ page }) => {
  await login(page);
  await page.goto("/library?q=seed");
  await expect(page.getByText("demo", { exact: false }).first()).toBeVisible();
  await page.getByRole("link", { name: /demo/i }).first().click();
  await expect(page).toHaveURL(/\/repository\/e2e-repo\?from=/);
  await page.getByRole("button", { name: /返回收藏库/ }).click();
  await expect(page).toHaveURL(/\/library\?q=seed/);
});

test("interactive controls expose accessible names", async ({ page }) => {
  await login(page);
  await page.goto("/library");
  const unnamed = await page.locator("button").evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const el = node as HTMLButtonElement;
        if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
        const name =
          el.getAttribute("aria-label") ||
          el.textContent?.trim() ||
          el.getAttribute("title") ||
          "";
        return name.length === 0;
      })
      .map((node) => (node as HTMLElement).outerHTML.slice(0, 120)),
  );
  expect(unnamed).toEqual([]);
});

test("no horizontal overflow on the library page", async ({ page }) => {
  await login(page);
  await page.goto("/library");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("no duplicate element ids on the library page", async ({ page }) => {
  await login(page);
  await page.goto("/library");
  const duplicates = await page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const el of Array.from(document.querySelectorAll("[id]"))) {
      const id = el.id;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  });
  expect(duplicates).toEqual([]);
});
