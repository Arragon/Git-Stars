# 开发指南

## 环境要求

- Node.js 22+（`node:sqlite` 为必需能力；CI 固定 22.x）
- npm 10+
- 本地开发需要在项目根目录的 `.env` 中配置：
  - `SESSION_SECRET`（必填）
  - `LOCAL_DEV_USER`（可选，启用本地开发登录）
  - `ALLOW_DEV_LOGIN`（可选，`NODE_ENV=production` 时开发登录必须显式设为 `true`；
    否则 `POST /api/auth/dev-login` 返回 `DEV_LOGIN_DISABLED`）
  - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`（可选，启用 GitHub OAuth）

## 常用命令

| 命令                      | 作用                                          |
| ------------------------- | --------------------------------------------- |
| `npm run dev`             | 启动开发服务器（后端 + 前端并行）             |
| `npm run dev:server`      | 仅启动后端（tsx watch）                       |
| `npm run dev:client`      | 仅启动前端（Vite）                            |
| `npm run check`           | 执行 TypeScript 项目检查（`tsc -b --noEmit`） |
| `npm run lint`            | 执行 ESLint 检查                              |
| `npm test`                | 执行 Vitest 单元测试                          |
| `npm run build`           | 执行 TypeScript 构建检查并生成生产构建产物    |
| `npm start`               | 启动生产服务器（单进程提供 API + 静态文件）   |
| `npm run preview`         | 预览生产构建产物（仅前端）                    |
| `npm run api:check`       | OpenAPI 校验（PR 含 breaking-change diff）    |
| `npm run migration:check` | 迁移 dry-run                                  |
| `npm run drill:backup`    | 备份/恢复/回滚演练                            |

开发服务器：

- 后端：`http://localhost:3001`
- 前端：`http://localhost:5173`（Vite 自动代理 `/api` 到后端）

生产服务器：

- 单端口：`http://localhost:3001`（同时提供 API 与 `dist/` 静态文件）

## 项目结构

```
gitstars/
├── server/                  # 后端（Node.js + Hono + SQLite）
│   ├── index.ts             # 入口：路由装配、静态文件、schema 守卫
│   ├── env.ts               # 环境变量（生产强校验）
│   ├── db.ts                # SQLite 初始化（legacy schema + migrations）
│   ├── migrations.ts        # 版本化迁移（每迁移一个事务）
│   ├── providers/           # github（真实）/ gitlab、gitee（fail-closed stub）
│   ├── services/            # repository、syncEngine、listsIo、publication、account*
│   ├── routes/              # auth、library、lists、tags、repositories、discover、
│   │                        # publications、public、hub、changes、sync、account…
│   ├── lib/                 # egress、rateLimit、obs、fractionalIndex
│   └── testing/             # bootstrap（内存 DB）、shareFixtures
├── src/                     # 前端（React + Vite）
│   ├── pages/               # Home、Library、Lists、RepositoryView、Hub、Settings…
│   ├── components/          # SyncDrawer、PendingMutations、ConflictPanel…
│   ├── data/                # IndexedDB/InMemory 驱动、缓存、离线 mutation
│   ├── sync/                # mutationQueue、pushReplay、pullSync、idMap、conflict*
│   ├── store/               # Zustand（auth、sync、toast、AI 配置）
│   └── utils/               # API 客户端、筛选、membership、noteSaveState…
├── scripts/                 # bench、api:check、migration-check、release-manifest、drill
├── docs/                    # ADR、runbooks、支持矩阵、证据索引
├── data/                    # SQLite 数据文件（gitignored）
└── dist/                    # 前端构建产物（gitignored）
```

## 数据库

SQLite 数据库文件默认位于 `data/gitstars.db`，可通过 `DATABASE_PATH` 环境变量自定义。

启动时先建 legacy 表，再执行 `server/migrations.ts` 的版本化迁移（每个迁移一个事务，
`schema_meta.schema_version` 记录当前版本）。数据库版本高于二进制时服务拒绝启动。

核心表（新域模型，ADR-0003）：`users`、`sessions`、`provider_accounts`、
`repositories`、`saved_repositories`、`lists`、`list_items`、`tags`、
`repository_tags`、`preferences`、`sync_states`、`change_log`、`idempotency_keys`、
`list_publications`、`publication_reports`、`audit_events`。
旧表 `projects` / `user_projects` / `collections` / `collection_projects` 仅为迁移兼容保留。

备份：`PRAGMA wal_checkpoint(TRUNCATE)` 后复制 `db` / `-wal` / `-shm`；运行
`npm run drill:backup` 验证恢复流程（证据记录在 `docs/runbooks/DRILL-LOG.md`）。

重置：停止服务，删除 `data/gitstars.db*`，重新启动（会删除用户数据）。

## 基线记录

以下结果来自本地后端迁移后的实际运行。

### `npm run check`

- 退出码：`0`
- 关键输出：`tsc -b --noEmit` 执行完成，无错误或警告。

### `npm run lint`

- 退出码：`0`（M7 batch 重新采集）

### `npm run build`

- 退出码：`0`
- 关键输出：前端构建成功，生成 `dist/` 目录。

### `npm test`

- 退出码：`0`（洁净环境、无开发者 `.env`）
- 覆盖：契约/迁移/路由/服务/同步一致性/数据隔离/安全负向用例
- 测试环境通过 `vite.config.ts` 的 `test.env` 注入受控 `SESSION_SECRET`；
  生产启动仍要求真实密钥（`server/env.ts`）

## CI 门禁

CI 工作流（`.github/workflows/ci.yml`）依次执行（ADR-0007 D4）：

- `npm ci`
- `npm run format:check`
- `npm run check`
- `npm run lint`（阻断）
- `npm test`
- `npm run api:check` — 校验 `server/openapi.yaml`；PR 时与目标分支基线做 breaking-change diff
- `npm run build`

唯一已记录的偏差：schema-breaking 基线对比（SQLite schema dump 对比）尚未实现，跟踪于 INH-319/INH-494。不需要 Docker 或外部数据库服务。

## 本地开发登录 vs GitHub OAuth

### 本地开发登录（`LOCAL_DEV_USER`）

设置 `LOCAL_DEV_USER=your-github-username` 后：

- 首页显示 "Sign in as {username}" 按钮
- 无需 GitHub OAuth App
- 只能拉取该用户的 public stars/forks
- 受 GitHub 匿名 API 限流（60 req/h/IP）

适合本地测试、快速验证。

### GitHub OAuth

设置 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET` 后：

- 首页显示 "Sign in with GitHub" 按钮
- 需要创建 GitHub OAuth App（回调 URL: `{PUBLIC_URL}/api/auth/github/callback`）
- 可以拉取 private repo 的 star/fork
- 不受匿名限流（使用用户 access_token）

适合生产部署、多用户场景。

两种模式可以共存，用户可以选择任一方式登录。

## 故障排查

### 后端启动失败

- 检查 `SESSION_SECRET` 是否设置
- 检查 `PORT` 是否被占用
- 检查 `DATABASE_PATH` 目录是否可写

### 前端无法连接后端

- 开发模式：确认后端在 `http://localhost:3001` 运行
- 检查 `vite.config.ts` 的 proxy 配置
- 浏览器控制台查看网络请求错误

### GitHub 同步失败

- 检查 `LOCAL_DEV_USER` 或 OAuth 配置
- GitHub API 限流：等待一段时间后重试
- 查看后端日志获取详细错误信息

### Session 丢失

- 检查 `SESSION_SECRET` 是否变更（变更后旧 session 失效）
- 检查 `data/gitstars.db` 中 `sessions` 表
- Cookie 设置：`HttpOnly`、`SameSite=Lax`、`Secure`（由 `COOKIE_SECURE` 控制）
