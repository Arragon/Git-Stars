# 开发指南

## 环境要求

- Node.js 20+（推荐 22+，内置 `node:sqlite`）
- npm 10+
- 本地开发需要在项目根目录的 `.env` 中配置：
  - `SESSION_SECRET`（必填）
  - `LOCAL_DEV_USER`（可选，启用本地开发登录）
  - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`（可选，启用 GitHub OAuth）

## 常用命令

| 命令                 | 作用                                          |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | 启动开发服务器（后端 + 前端并行）             |
| `npm run dev:server` | 仅启动后端（tsx watch）                       |
| `npm run dev:client` | 仅启动前端（Vite）                            |
| `npm run check`      | 执行 TypeScript 项目检查（`tsc -b --noEmit`） |
| `npm run lint`       | 执行 ESLint 检查                              |
| `npm test`           | 执行 Vitest 单元测试                          |
| `npm run build`      | 执行 TypeScript 构建检查并生成生产构建产物    |
| `npm start`          | 启动生产服务器（单进程提供 API + 静态文件）   |
| `npm run preview`    | 预览生产构建产物（仅前端）                    |

开发服务器：

- 后端：`http://localhost:3001`
- 前端：`http://localhost:5173`（Vite 自动代理 `/api` 到后端）

生产服务器：

- 单端口：`http://localhost:3001`（同时提供 API 与 `dist/` 静态文件）

## 项目结构

```
gitstars/
├── server/              # 本地后端（Node.js + Hono + SQLite）
│   ├── index.ts         # 入口，挂载路由与静态文件
│   ├── env.ts           # 环境变量读取
│   ├── db.ts            # SQLite 初始化与 schema
│   ├── session.ts       # Session 管理（cookie + DB）
│   ├── github.ts        # GitHub API 客户端
│   ├── middleware/
│   │   └── auth.ts      # 认证中间件
│   └── routes/
│       ├── auth.ts      # 登录/登出/OAuth
│       ├── projects.ts  # 项目 CRUD
│       ├── sync.ts      # GitHub 同步
│       ├── activity.ts  # 项目活跃度分析
│       └── collections.ts # 收藏夹 CRUD
├── src/                 # 前端（React + Vite）
│   ├── components/
│   ├── pages/
│   ├── store/
│   └── utils/
│       ├── api.ts       # 后端 API 客户端封装
│       ├── github.ts    # 同步触发（调后端）
│       └── ...
├── data/                # SQLite 数据文件（gitignored）
│   └── gitstars.db
├── dist/                # 前端构建产物（gitignored）
└── docs/
```

## 数据库

SQLite 数据库文件默认位于 `data/gitstars.db`，可通过 `DATABASE_PATH` 环境变量自定义。

启动时自动执行 `CREATE TABLE IF NOT EXISTS` 初始化 schema，无需手动迁移。

核心表：

- `users`：用户信息 + GitHub access_token
- `sessions`：登录会话（30 天有效期）
- `projects`：仓库元信息
- `user_projects`：用户与仓库关联（star/fork）
- `collections`：用户自定义收藏夹
- `collection_projects`：收藏夹与项目关联

备份：直接复制 `data/gitstars.db` 文件。

重置：停止服务，删除 `data/gitstars.db*`，重新启动。

## 基线记录

以下结果来自本地后端迁移后的实际运行。

### `npm run check`

- 退出码：`0`
- 关键输出：`tsc -b --noEmit` 执行完成，无错误或警告。

### `npm run lint`

- 退出码：`1`
- 共 `17` 个 error（历史遗留，不在本次迁移范围）。
- `@typescript-eslint/no-explicit-any`：`16` 个 error
- `prefer-const`：`1` 个 error

### `npm run build`

- 退出码：`0`
- 关键输出：前端构建成功，生成 `dist/` 目录。

### `npm test`

- 退出码：`0`
- 测试套件：
  - `src/utils/collections.test.ts`
  - `src/utils/syncIdentity.test.ts`
  - `server/db.test.ts`
  - `server/routes/auth.test.ts`

## CI 门禁

CI 工作流（`.github/workflows/ci.yml`）依次执行：

- `npm ci`
- `npm run check`
- `npm run lint`（当前保留 `continue-on-error: true`，待清零既有 lint error 后移除）
- `npm test`
- `npm run build`

不需要 Docker 或外部数据库服务。

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
