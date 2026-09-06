# GitStars

一个用于可视化、管理 GitHub Stars & Forks 的 Web 应用：使用 GitHub OAuth 登录后，从 GitHub API 拉取你的 Star/Fork 数据，落库到本地 SQLite 数据库，在 Dashboard 中进行检索、筛选、排序，并可选用 AI 生成项目摘要与标签。

## 技术栈

- 前端：React + TypeScript + Vite + Tailwind CSS
- 状态管理：Zustand
- 后端：Node.js + Hono + SQLite（单进程，同时提供 API 与静态文件）
- 认证：GitHub OAuth（服务端托管）+ 本地开发登录旁路
- 数据库：SQLite（`data/gitstars.db`，自动初始化）
- 数据获取：GitHub REST API（服务端代理）

## 快速开始（本地开发）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少设置：

```bash
SESSION_SECRET=any-random-string-here
LOCAL_DEV_USER=your-github-username
```

- `SESSION_SECRET`：用于签名 session cookie，任意随机字符串即可
- `LOCAL_DEV_USER`：你的 GitHub 用户名，启用本地开发登录（无需 OAuth）

### 3. 启动开发服务器

```bash
npm run dev
```

这会同时启动：

- 后端 API 服务器：`http://localhost:3001`
- 前端 Vite 开发服务器：`http://localhost:5173`（自动代理 `/api` 到后端）

打开 `http://localhost:5173`，点击 "Sign in as {your-username}" 即可登录。

### 4. 生产部署

```bash
npm run build
npm start
```

后端会在 `http://localhost:3001` 同时提供 API 与前端静态文件（SPA 回退）。

## 环境变量

| 变量                   | 必填   | 默认值                    | 说明                           |
| ---------------------- | ------ | ------------------------- | ------------------------------ |
| `PORT`                 | 否     | `3001`                    | 后端服务端口                   |
| `DATABASE_PATH`        | 否     | `./data/gitstars.db`      | SQLite 数据库文件路径          |
| `SESSION_SECRET`       | **是** | -                         | Session cookie 签名密钥        |
| `PUBLIC_URL`           | 否     | `http://localhost:{PORT}` | 用于生成 OAuth 回调 URL        |
| `COOKIE_SECURE`        | 否     | `false`                   | HTTPS 部署时设为 `true`        |
| `GITHUB_CLIENT_ID`     | 否     | -                         | GitHub OAuth App Client ID     |
| `GITHUB_CLIENT_SECRET` | 否     | -                         | GitHub OAuth App Client Secret |
| `LOCAL_DEV_USER`       | 否     | -                         | 本地开发登录的 GitHub 用户名   |

### 登录方式

**方式 A：本地开发登录（推荐用于本地测试）**

设置 `LOCAL_DEV_USER=your-github-username`，首页会显示 "Sign in as {username}" 按钮。此模式：

- 无需 GitHub OAuth App
- 只能拉取该用户的 public stars/forks
- 受 GitHub 匿名 API 限流（60 req/h/IP）

**方式 B：GitHub OAuth（生产推荐）**

1. 在 [GitHub Developer Settings](https://github.com/settings/developers) 创建 OAuth App
2. Homepage URL: `http://localhost:3001`（或你的生产域名）
3. Authorization callback URL: `http://localhost:3001/api/auth/github/callback`
4. 将 Client ID/Secret 填入 `.env`
5. 清空 `LOCAL_DEV_USER`（可选，两者可共存）

OAuth 模式可以拉取 private repo 的 star/fork，且不受匿名限流。

## 数据获取流程

1. **登录**：首页点击登录按钮 → 后端创建 session → 跳转 Dashboard
2. **同步**：Dashboard 点击 "Sync Data" → 后端用你的 GitHub token 拉取 stars/forks → 存入 SQLite
3. **浏览**：前端从后端 API 读取项目列表，支持搜索、筛选、排序
4. **AI 摘要**（可选）：配置 AI provider 后，可为项目生成摘要与标签

同步逻辑：

- 首次同步：最多拉取 500 条（5 页 × 100 条）
- 增量同步：只拉取 `last_synced_at` 之后的新数据
- GitHub API 限流：后端会返回 429 错误，前端提示稍后再试

## 数据存储

所有数据存储在本地 SQLite 文件 `data/gitstars.db`（可通过 `DATABASE_PATH` 自定义）。

核心表：

- `users`：用户信息 + GitHub access_token
- `sessions`：登录会话
- `projects`：仓库元信息（GitHub 公共数据）
- `user_projects`：用户与仓库关联（star/fork + 时间）
- `collections`：用户自定义收藏夹
- `collection_projects`：收藏夹与项目关联

备份：直接复制 `data/gitstars.db` 文件即可。

## 开发与校验

```bash
npm run dev          # 启动开发服务器（前后端并行）
npm run check        # TypeScript 类型检查
npm run lint         # ESLint 检查
npm test             # Vitest 单元测试
npm run build        # 生产构建（前端 + 类型检查）
npm start            # 启动生产服务器
```

更多开发细节请参阅 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 本地后端架构

详见 [docs/LOCAL-BACKEND.md](docs/LOCAL-BACKEND.md)。

## 信息安全说明

### 密钥与配置

- `SESSION_SECRET` 用于签名 session cookie，不要泄露
- `GITHUB_CLIENT_SECRET` 只存在服务端 `.env`，不会进入前端构建
- GitHub `access_token` 存储在 SQLite `users.access_token` 列，不会返回给前端

### 认证与令牌

- Session cookie：`HttpOnly`、`SameSite=Lax`、有效期 30 天
- GitHub API 调用全部通过后端代理，前端不直接持有 GitHub token
- `LOCAL_DEV_USER` 模式创建的 session 没有 access_token，同步时走匿名 API

### 数据库访问控制

- 所有 API 端点（除 `/api/auth/*`）都需要有效 session
- 用户只能访问自己的数据（`WHERE user_id = ?` 强制隔离）
- `projects` 表全局共享（多个用户可能同步到同一个 repo）

### AI 功能的安全边界

Dashboard 支持为项目生成 AI 摘要/标签。当前实现为"浏览器直连模型 API"：

- API Key 由用户在页面设置中填写并保存在浏览器 localStorage
- 任何前端直连方案都无法完全避免用户侧泄露风险

更安全的做法是将 AI 调用放到后端，由服务端保管密钥（未来优化方向）。

## 常见问题

### 登录后仍然报错/同步失败

- 检查 `LOCAL_DEV_USER` 是否正确设置（开发模式）
- 检查 GitHub OAuth App 的回调 URL 是否匹配（OAuth 模式）
- GitHub API 可能触发速率限制（429 错误），稍后再试

### 页面刷新 404

开发模式下 Vite 会自动处理 SPA 回退。生产模式下后端会 serve `dist/index.html` 作为回退。

### 数据库文件在哪里？

默认在 `data/gitstars.db`。可以通过 `DATABASE_PATH` 环境变量自定义。

### 如何重置数据？

停止服务，删除 `data/gitstars.db`（及 `.db-wal`、`.db-shm`），重新启动即可。
