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

test("note edit survives a reload", async ({ page }, testInfo) => {
  // Tests share the seeded server database, so the note must be unique per run:
  // an unchanged value is a no-op save and never reaches the "已保存" state.
  const note = `e2e note ${testInfo.project.name} ${Date.now()}`;
  await login(page);
  await page.goto("/repository/e2e-repo");
  const editor = page.getByLabel("个人备注");
  await expect(editor).toBeVisible();
  await editor.fill(note);
  await editor.blur();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByLabel("个人备注")).toHaveValue(note);
});

test("filter context survives the repository round trip", async ({ page }) => {
  await login(page);
  await page.goto("/library?q=demo");
  await expect(page.getByText("demo", { exact: false }).first()).toBeVisible();
  await page.getByRole("link", { name: /demo/i }).first().click();
  await expect(page).toHaveURL(/\/repository\/e2e-repo\?from=/);
  await page.getByRole("button", { name: /返回收藏库/ }).click();
  await expect(page).toHaveURL(/\/library\?q=demo/);
});

test("interactive controls expose accessible names", async ({ page }) => {
  await login(page);
  await page.goto("/library");
  const unnamed = await page.locator("button").evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const el = node as HTMLButtonElement;
        if (el.hidden || el.getAttribute("aria-hidden") === "true")
          return false;
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

// G8: an unconfigured AI must never block the core Library flow.
test("unconfigured AI shows an error but leaves the library usable", async ({
  page,
  isMobile,
}) => {
  await login(page);
  await page.goto("/library");
  await expect(page.getByText("demo", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: /AI 摘要/ }).click();
  await page.getByRole("button", { name: /补充缺失摘要/ }).click();

  // The failure is surfaced, not swallowed, and it is a recoverable state.
  await expect(page.getByRole("alert")).toContainText(/AI 设置|API Key/);
  // Dismiss the dialog, then confirm the library still works end to end.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByLabel("搜索收藏库").fill("demo");
  await expect(page.getByText("demo", { exact: false }).first()).toBeVisible();
  // The sidebar link only exists on desktop; below the breakpoint it lives in the
  // closed drawer, so the search result above already proves the page still works.
  if (!isMobile) {
    await page.getByRole("link", { name: /收藏库/ }).click();
    await expect(page).toHaveURL(/\/library/);
  }
});
