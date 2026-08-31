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

A3 将在此记录 Supabase CLI 的数据库测试命令、实际输出及本地运行结果。
