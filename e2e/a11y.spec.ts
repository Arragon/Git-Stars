// M8-10 extended accessibility gate: axe scan, viewport overflow matrix,
// dialog/drawer focus behavior. Complements core.spec.ts journeys.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/dev-login");
  expect(res.ok()).toBeTruthy();
}

async function expectNoSeriousAxeViolations(
  page: Page,
  context: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(
    serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} nodes`),
    `${context} must have no critical/serious axe violations`,
  ).toEqual([]);
}

test("axe finds no serious violations on the library page", async ({
  page,
}) => {
  await login(page);
  await page.goto("/library");
  await expect(page.getByText("demo", { exact: false }).first()).toBeVisible();
  await expectNoSeriousAxeViolations(page, "library");
});

test("axe finds no serious violations on the repository page", async ({
  page,
}) => {
  await login(page);
  await page.goto("/repository/e2e-repo");
  await expect(page.getByRole("heading", { name: "demo" })).toBeVisible();
  await expectNoSeriousAxeViolations(page, "repository");
});

// M8-10 AC: 320/390/768/1440/1920 无整页水平溢出。
for (const width of [320, 390, 768, 1440, 1920]) {
  test(`library has no horizontal overflow at ${width}px`, async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/library");
    await expect(
      page.getByText("demo", { exact: false }).first(),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

// M8-10 AC: 核心 dialog 有正确初始焦点，Esc 关闭后焦点回到 trigger。
test("dialog receives initial focus and restores it on Esc", async ({
  page,
}) => {
  await login(page);
  await page.goto("/library");
  const trigger = page.getByRole("button", { name: /AI 摘要/ });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const d = document.querySelector("dialog[open]");
        return d ? d.contains(document.activeElement) : false;
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

// M8-10 AC: mobile drawer 关闭后不可聚焦，Esc 关闭并恢复 trigger 焦点。
test("mobile drawer is unfocusable when closed and Esc restores focus", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "the off-canvas drawer is mobile-only");
  await login(page);
  await page.goto("/library");
  const sidebar = page.locator("aside.sidebar");
  // Closed: visibility:hidden makes every link/button inside untabbable.
  const tabbableWhenClosed = await sidebar.evaluate(
    (el) =>
      Array.from(el.querySelectorAll("a, button")).filter(
        (n) => getComputedStyle(n).visibility !== "hidden",
      ).length,
  );
  expect(tabbableWhenClosed).toBe(0);

  const trigger = page.getByRole("button", { name: "打开导航" });
  await trigger.click();
  await expect(sidebar).toHaveClass(/open/);
  await page.keyboard.press("Escape");
  await expect(sidebar).not.toHaveClass(/open/);
  await expect(trigger).toBeFocused();
});
