# DESIGN.md — GitStars 视觉与交互约定

依据：`GitStars-Redesign.html` 视觉基线与 `GitStars-UI-UX-Agent-Guide.md` 行为契约。
本文件只记录**跨页面持久**的设计决策；页面局部样式不在此处。

## 1. 主题与色彩

- 主题通过 `<html>` 上的 `.dark` class 切换（`src/hooks/useTheme.ts`：light/dark/system）。
- **语义色彩令牌**定义在 `src/index.css`（`--c-*` CSS 变量），并映射到 Tailwind（`tailwind.config.js`）：
  页面代码使用 `bg-canvas / bg-surface / bg-subtle / bg-side / text-ink / text-muted /
border-line / border-line-strong / bg-brand / text-brand-text / text-ai / text-gold /
text-info / text-danger` 等**语义类**，双主题自动生效。
- **禁止**在页面里手写 `gray-XXX dark:gray-XXX` 双写——那是旧系统；一律用语义类。
- 色彩角色：
  - 苔绿 `brand`：主按钮、当前导航、选中态（暗色下是浅绿底+深字，由 `--c-brand-contrast` 决定按钮前景）。
  - 琥珀 `gold`：品牌星标、Star、提醒。
  - 紫灰 `ai`：**只用于 AI 功能**（摘要、AI 标签、批量总结、智能归类）。
  - 雾蓝 `info`：信息提示。红 `danger`：错误与危险操作。

## 2. 布局

- **AppShell**（登录后）：固定侧栏（216px → 1050px 以下 184px → 900px 以下 64px 图标栏 →
  560px 以下抽屉 + scrim）+ 顶栏（面包屑、同步 pill、主题切换）+ 内容区
  （`max-w-[1880px]`，页边距 30/24/16px）。
- **PublicShell**（匿名）：仅品牌 + Hub 链接 + 主题 + 登录按钮的最小顶栏。
  `/hub` 与 `/s/*` 保持匿名可达。
- 页面不再自设 `max-w-*` 外层容器；只有阅读正文有行长限制
  （RepositoryView 1240px，公开页 990px）。
- Lists 为 242/205px 目录 + 内容区工作区；≤720px 目录转为横向选择。

## 3. 组件原语（`src/components/ui.tsx`）

- `Button`：variant = primary（苔绿实底）/ secondary（描边）/ ghost / danger /
  danger-solid / ai（紫灰文字）/ brand；size = xs/sm/md/icon。
  默认 `type="button"`；表单提交需显式 `type="submit"`。
- `IconButton` 必须传 `aria-label`。
- `Input/Select/Textarea` 统一 36px 高、7px 圆角、`--c-focus` 聚焦描边；均支持 ref。
- `Dialog` 基于原生 `<dialog>`（Esc 由平台处理，点背板关闭）；需要保护焦点的任务
  （创建/导入/删除/AI）用 Dialog，不中断任务的选择用 popover。
- `Notice`（error/info/success/warning）用于持久反馈；操作成功瞬时可后续接 Toast。
- `EmptyState`、`Skeleton/SkeletonCard` 为空态与加载骨架的标准形态。

## 4. 交互约定

- 主搜索只检索收藏库；来源发现是独立面板（Library 页头按钮）。
- 筛选语义保持：AI 标签多选 AND、`kinds` 数组（star/fork 可同时持有）、
  排序值 `added_at|stars|name`。
- 卡片承担识别与判断；完整 AI 摘要、备注编辑、标签管理在阅读侧栏或对话框。
- 离线禁用项必须有文字原因（不能只靠 tooltip）；离线保存成功提示
  「已保存到本地，联网后自动同步」。
- 破坏性操作走 `ConfirmDialog`（或两步确认），不再使用原生 `confirm` 于主流程。

## 5. 响应式断点

| 宽度        | 行为                                       |
| ----------- | ------------------------------------------ |
| ≥1701px     | Library 三列（内容自适应，容器 1880px）    |
| 1251–1700px | Library 两列                               |
| 721–1250px  | Library 两列 → 视图切换；阅读侧栏仍在右侧  |
| 561–900px   | 侧栏 64px 图标栏（文字隐藏，tooltip 保留） |
| ≤560px      | 侧栏变抽屉；工具栏换行；卡片单列           |
