# 开发指南

## 环境要求

- Node.js 20
- npm 10
- 本地开发需要在项目根目录的 `.env` 中配置：
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 本地开发服务器 |
| `npm run check` | 执行 TypeScript 项目检查（`tsc -b --noEmit`） |
| `npm run lint` | 执行 ESLint 检查 |
| `npm run test` | 执行 Vitest 单元测试 |
| `npm run build` | 执行 TypeScript 构建检查并生成生产构建产物 |
| `npm run preview` | 预览生产构建产物 |

## 基线记录

以下结果来自本次 PHASE A 执行前实际运行。

### `npm run check`

- 退出码：`0`
- 关键输出：`tsc -b --noEmit` 执行完成，无错误或警告。

### `npm run lint`

- 退出码：`1`
- 共 `18` 个问题：`17` 个 error、`1` 个 warning。
- `@typescript-eslint/no-explicit-any`：`16` 个 error
- `prefer-const`：`1` 个 error
- `react-hooks/exhaustive-deps`：`1` 个 warning
- 其中 `17` 个 error 是 A1 之前就存在的基线失败，不在 PHASE A 修复范围，由 PHASE E（E1 生成 Supabase 类型 / E2 渐进开启 strict）处理。

### `npm run build`

- 退出码：`0`
- 关键输出：`2651 modules transformed`，构建成功。
- 生成的 JavaScript 单 chunk 约 `978.52 kB`，触发 Vite 的 `500 kB` chunk 大小警告。

## 数据库测试

数据库测试使用 Supabase CLI 的 pgTAP 支持。根据本机 `npx supabase --help`、`npx supabase test --help` 和 `npx supabase db --help` 的实际输出：

- `npx supabase test db [flags] [<path...>]`：使用 pgTAP 测试本地数据库。
- `npx supabase db reset [flags]`：使用本地迁移重置数据库。
- `npx supabase start`：启动本地 Supabase 栈。
- `npx supabase stop`：停止本地 Supabase 栈。

A3 添加的 smoke test 位于 `supabase/tests/database/000_schema_smoke.test.sql`，检查 `users`、`projects`、`user_projects` 和 `collections` 四张表。测试在事务中创建/使用 pgTAP，并在结尾回滚，不修改生产 schema。

本次实际运行：

```text
npx supabase start
退出码：0
结果：本地 Supabase 栈启动成功。
注意：启动时跳过了 secure_rls.sql（文件名必须匹配 "<timestamp>_name.sql"）。
警告：未找到 supabase/seed.sql。

npx supabase db reset
退出码：0
结果：重建数据库并成功应用 5 个带时间戳的迁移。
注意：secure_rls.sql 仍被跳过；未找到 supabase/seed.sql。

npx supabase test db
退出码：0
结果：All tests successful.
Files=1, Tests=4
Result: PASS

npx supabase stop
退出码：0
结果：本地 Supabase 开发栈已停止。
```

`npx supabase test db` 首次拉取 `pg_prove` 镜像时出现了 registry 的 `Data limit exceeded` 重试信息，随后镜像成功拉取，测试通过。

`secure_rls.sql` 没有时间戳前缀，因此 `db reset` 实际跳过了它。本 milestone 不修改、重命名或删除该迁移文件；B1 处理该问题。

## CI 门禁

CI 工作流依次执行：

- `npm ci`
- `npm run check`
- `npm run lint`（当前保留 `continue-on-error: true`，待 PHASE E2 清零既有 lint error 后移除）
- `npm test`
- `npm run build`

数据库测试暂不加入 CI，作为待办保留；后续是否加入取决于本地 Supabase 栈的可靠 CI 运行条件。
