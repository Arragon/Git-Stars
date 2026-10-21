// M8-10: accessibility-tree audit. A screen reader consumes this tree — roles,
// names, states — so asserting on it is the closest automated proxy for the
// manual pass over drawer, dialogs and tabs. Speech order/verbosity still need
// a human; that residual risk is recorded in docs/A11Y-REPORT.md.
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/dev-login");
  expect(res.ok()).toBeTruthy();
}

interface AxNode {
  role?: { value?: string };
  name?: { value?: string };
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
  ignored?: boolean;
}

async function axTree(page: Page): Promise<AxNode[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await session.send("Accessibility.getFullAXTree")) as {
      nodes: AxNode[];
    };
    return nodes.filter((n) => !n.ignored);
  } finally {
    await session.detach();
  }
}

const roleOf = (n: AxNode) => n.role?.value ?? "";
const nameOf = (n: AxNode) => n.name?.value ?? "";

test("library page exposes landmarks and named controls in the AX tree", async ({
  page,
  isMobile,
}) => {
  await login(page);
  await page.goto("/library");
  await expect(page.getByText("demo", { exact: false }).first()).toBeVisible();
  const nodes = await axTree(page);

  const roles = new Set(nodes.map(roleOf));
  expect(roles.has("main")).toBe(true);
  // The sidebar (and its nav landmark) is off-canvas below the mobile breakpoint,
  // where it is opened from the "打开导航" trigger instead.
  if (!isMobile) expect(roles.has("navigation")).toBe(true);
  // Name a screen reader would announce for the primary search control.
  expect(
    nodes.some(
      (n) => roleOf(n) === "textbox" && nameOf(n).includes("搜索收藏库"),
    ),
  ).toBe(true);
  // The account menu trigger must not be an unnamed button.
  const unnamedButtons = nodes.filter(
    (n) => roleOf(n) === "button" && nameOf(n).trim() === "",
  );
  expect(unnamedButtons).toEqual([]);
});

test("repository tabs expose role, name and selected state", async ({
  page,
}) => {
  await login(page);
  await page.goto("/repository/e2e-repo");
  await expect(page.getByRole("heading", { name: "demo" })).toBeVisible();
  const nodes = await axTree(page);

  const tabs = nodes.filter((n) => roleOf(n) === "tab");
  expect(tabs.length).toBeGreaterThanOrEqual(2);
  expect(tabs.map(nameOf)).toEqual(
    expect.arrayContaining(["README", "文件", "Releases"]),
  );
  const selected = tabs.filter((t) =>
    t.properties?.some((p) => p.name === "selected" && p.value?.value === true),
  );
  expect(selected.length).toBe(1);
  expect(nameOf(selected[0])).toBe("README");
  // The tablist itself must be announced as a named group.
  expect(
    nodes.some((n) => roleOf(n) === "tablist" && nameOf(n) === "仓库内容"),
  ).toBe(true);
});

test("batch dialog is announced with a name and labelled controls", async ({
  page,
}) => {
  await login(page);
  await page.goto("/library");
  await page.getByRole("button", { name: /AI 摘要/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const nodes = await axTree(page);

  const dialog = nodes.find((n) => roleOf(n) === "dialog");
  expect(dialog).toBeTruthy();
  expect(nameOf(dialog!)).toContain("批量生成 AI 摘要");
  const dialogButtons = nodes.filter((n) => roleOf(n) === "button");
  expect(dialogButtons.every((b) => nameOf(b).trim() !== "")).toBe(true);
});

test("closed mobile drawer is absent from the AX tree", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "the off-canvas drawer is mobile-only");
  await login(page);
  await page.goto("/library");
  const closed = await axTree(page);
  // visibility:hidden removes the subtree from the accessibility tree, so a
  // screen reader cannot reach the navigation links while the drawer is shut.
  expect(closed.some((n) => roleOf(n) === "link" && nameOf(n) === "设置")).toBe(
    false,
  );

  await page.getByRole("button", { name: "打开导航" }).click();
  await expect
    .poll(async () => {
      const open = await axTree(page);
      return open.some((n) => roleOf(n) === "link" && nameOf(n) === "设置");
    })
    .toBe(true);
});
