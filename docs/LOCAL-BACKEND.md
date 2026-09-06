# GitStars 本地后端架构

本文档描述 GitStars 本地后端的架构设计、API 端点、Session 模型、SQLite schema 以及部署配置。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Node.js 单进程                            │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Hono HTTP Server                       │   │
│  │              (port 3001)                            │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  /api/auth/*      认证路由（OAuth + dev login）      │   │
│  │  /api/projects/*  项目 CRUD                         │   │
│  │  /api/sync/*      GitHub 同步                       │   │
│  │  /api/collections/*  收藏夹 CRUD                    │   │
│  │  /api/github/*    GitHub API 代理                   │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  /* (production)  静态文件 + SPA 回退               │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              SQLite (data/gitstars.db)              │   │
│  │              - users / sessions                     │   │
│  │              - projects / user_projects             │   │
│  │              - collections / collection_projects    │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              GitHub API (服务端调用)                 │   │
│  │              - OAuth token exchange                 │   │
│  │              - Stars / Forks 拉取                   │   │
│  │              - Activity 分析                        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**关键设计决策**：

- 单进程同时提供 API 与静态文件，简化部署
- GitHub OAuth flow 与 API 调用全部在服务端，前端不持有 GitHub token
- SQLite 单文件数据库，零配置，自动初始化
- Session 用 HttpOnly cookie，服务端 DB 存储

## API 端点

### 认证 (`/api/auth`)

| 方法 | 路径                        | 说明                      | 认证 |
| ---- | --------------------------- | ------------------------- | ---- |
| GET  | `/api/auth/session`         | 获取当前 session 用户信息 | 否   |
| POST | `/api/auth/logout`          | 登出，销毁 session        | 否   |
| GET  | `/api/auth/github/login`    | 跳转 GitHub OAuth         | 否   |
| GET  | `/api/auth/github/callback` | OAuth 回调处理            | 否   |
| POST | `/api/auth/dev-login`       | 本地开发登录              | 否   |

**`GET /api/auth/session` 响应**：

```json
{
  "user": {
    "id": "uuid",
    "github_id": "12345",
    "username": "octocat",
    "email": "octocat@github.com",
    "avatar_url": "https://...",
    "full_name": "The Octocat",
    "last_synced_at": "2024-01-01T00:00:00.000Z"
  },
  "devLoginEnabled": true,
  "devLoginUsername": "octocat",
  "githubOAuthConfigured": true
}
```

未登录时 `user` 为 `null`。

### 项目 (`/api/projects`)

| 方法  | 路径                   | 说明                                        | 认证 |
| ----- | ---------------------- | ------------------------------------------- | ---- |
| GET   | `/api/projects/me`     | 获取当前用户的所有项目（含 star/fork 类型） | 是   |
| GET   | `/api/projects/:id`    | 获取单个项目详情                            | 是   |
| PATCH | `/api/projects/:id/ai` | 更新项目的 AI 摘要与标签                    | 是   |

**`GET /api/projects/me` 响应**：

```json
[
  {
    "id": "uuid",
    "github_id": 123456,
    "name": "repo-name",
    "full_name": "owner/repo-name",
    "description": "...",
    "language": "TypeScript",
    "stars_count": 100,
    "forks_count": 50,
    "html_url": "https://github.com/owner/repo-name",
    "github_created_at": "2020-01-01T00:00:00Z",
    "github_updated_at": "2024-01-01T00:00:00Z",
    "activity_index": 75,
    "activity_details": { "commits": 20, "issues": 5, "prs": 3, "releases": 2 },
    "activity_analyzed_at": "2024-01-01T00:00:00Z",
    "ai_summary": "...",
    "ai_tags": ["tag1", "tag2"],
    "type": "star",
    "starred_at": "2024-01-01T00:00:00Z"
  }
]
```

### 同步 (`/api/sync`)

| 方法 | 路径               | 说明                         | 认证 |
| ---- | ------------------ | ---------------------------- | ---- |
| POST | `/api/sync/github` | 触发 GitHub stars/forks 同步 | 是   |

**响应**：

```json
{
  "status": "success",
  "startedAt": "2024-01-01T00:00:00.000Z",
  "completedAt": "2024-01-01T00:00:05.000Z",
  "inserted": { "projects": 10, "links": 10 },
  "fetched": { "stars": 8, "forks": 2 }
}
```

错误时返回 `{ "status": "failed", "code": "GITHUB_RATE_LIMIT", "message": "..." }`。

### 收藏夹 (`/api/collections`)

| 方法   | 路径                         | 说明                                   | 认证 |
| ------ | ---------------------------- | -------------------------------------- | ---- |
| GET    | `/api/collections`           | 获取当前用户的所有收藏夹（含关联项目） | 是   |
| POST   | `/api/collections`           | 创建收藏夹                             | 是   |
| PATCH  | `/api/collections/:id`       | 更新收藏夹                             | 是   |
| DELETE | `/api/collections/:id`       | 删除收藏夹                             | 是   |
| POST   | `/api/collections/-projects` | 批量添加项目到收藏夹                   | 是   |
| DELETE | `/api/collections/-projects` | 批量从收藏夹移除项目                   | 是   |

### GitHub API 代理 (`/api/github`)

| 方法 | 路径                                | 说明               | 认证 |
| ---- | ----------------------------------- | ------------------ | ---- |
| GET  | `/api/github/activity/:owner/:repo` | 分析仓库近期活跃度 | 是   |

## Session 模型

- **存储**：SQLite `sessions` 表
- **Cookie 名称**：`gitstars_session`
- **Cookie 属性**：`HttpOnly`、`SameSite=Lax`、`Path=/`、`Secure`（由 `COOKIE_SECURE` 控制）
- **有效期**：30 天
- **签名**：Cookie 值为 `<sessionId>.<HMAC-SHA256签名>`，防止篡改
- **清理**：启动时 + 每小时自动清理过期 session

## SQLite Schema

### users

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  full_name TEXT,
  access_token TEXT,
  last_synced_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  github_id INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  description TEXT,
  language TEXT,
  stars_count INTEGER NOT NULL DEFAULT 0,
  forks_count INTEGER NOT NULL DEFAULT 0,
  html_url TEXT NOT NULL,
  github_created_at TEXT,
  github_updated_at TEXT,
  activity_index REAL NOT NULL DEFAULT 0,
  activity_details TEXT NOT NULL DEFAULT '{}',
  activity_analyzed_at TEXT,
  ai_summary TEXT,
  ai_tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### user_projects

```sql
CREATE TABLE user_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('star', 'fork')),
  starred_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id, type)
);
```

### collections

```sql
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  auto_collect_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);
```

### collection_projects

```sql
CREATE TABLE collection_projects (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(collection_id, project_id)
);
```

## GitHub OAuth 配置

### 创建 OAuth App

1. 访问 [GitHub Developer Settings](https://github.com/settings/developers)
2. 点击 "New OAuth App"
3. 填写：
   - **Application name**: GitStars (或任意名称)
   - **Homepage URL**: `http://localhost:3001`（或你的生产域名）
   - **Authorization callback URL**: `http://localhost:3001/api/auth/github/callback`
4. 创建后记录 Client ID 和 Client Secret
5. 填入 `.env`：
   ```bash
   GITHUB_CLIENT_ID=your-client-id
   GITHUB_CLIENT_SECRET=your-client-secret
   PUBLIC_URL=http://localhost:3001
   ```

### OAuth Scopes

后端请求的 scopes：`read:user user:email`

- `read:user`：读取用户 profile
- `user:email`：读取用户邮箱（可选）

同步 stars/forks 使用用户的 access_token，可以访问 private repo。

## 本地开发登录（`LOCAL_DEV_USER`）

设置 `LOCAL_DEV_USER=your-github-username` 后：

- 首页显示 "Sign in as {username}" 按钮
- 点击后调用 `POST /api/auth/dev-login`
- 后端创建一个本地用户（`github_id = 'dev:{username}'`）
- 不获取 GitHub access_token
- 同步时走 GitHub 匿名 API（只能拉取 public 数据，受限流 60 req/h/IP）

适合本地测试、快速验证，无需配置 OAuth App。

## 权限控制

- 所有 `/api/*` 端点（除 `/api/auth/session`、`/api/auth/logout`、`/api/auth/github/*`、`/api/auth/dev-login`）都需要有效 session
- 用户只能访问自己的数据：`WHERE user_id = ?` 强制隔离
- `projects` 表全局共享（多个用户可能同步到同一个 repo），但只有登录用户可读写
- `collections` 和 `collection_projects` 严格按用户隔离

## 部署

### 开发模式

```bash
npm run dev
```

- 后端：`http://localhost:3001`（tsx watch，热重载）
- 前端：`http://localhost:5173`（Vite，自动代理 `/api` 到后端）

### 生产模式

```bash
npm run build
npm start
```

- 单进程：`http://localhost:3001`
- 同时提供 API 与 `dist/` 静态文件
- SPA 回退：非 API 路由返回 `dist/index.html`

### 环境变量

| 变量                   | 必填   | 默认值                    | 说明                       |
| ---------------------- | ------ | ------------------------- | -------------------------- |
| `PORT`                 | 否     | `3001`                    | 服务端口                   |
| `DATABASE_PATH`        | 否     | `./data/gitstars.db`      | SQLite 文件路径            |
| `SESSION_SECRET`       | **是** | -                         | Session 签名密钥           |
| `PUBLIC_URL`           | 否     | `http://localhost:{PORT}` | OAuth 回调基础 URL         |
| `COOKIE_SECURE`        | 否     | `false`                   | HTTPS 时设为 `true`        |
| `GITHUB_CLIENT_ID`     | 否     | -                         | GitHub OAuth Client ID     |
| `GITHUB_CLIENT_SECRET` | 否     | -                         | GitHub OAuth Client Secret |
| `LOCAL_DEV_USER`       | 否     | -                         | 本地开发登录用户名         |

## 备份与迁移

### 备份

直接复制 `data/gitstars.db` 文件（及 `.db-wal`、`.db-shm` 如果存在）。

### 恢复

停止服务，将备份文件复制到 `data/gitstars.db`，重新启动。

### 从 Supabase 迁移

本项目不再支持 Supabase。如需从旧版 Supabase 部署迁移数据：

1. 从 Supabase Dashboard 导出 SQL dump
2. 手工映射表结构到 SQLite schema
3. 导入数据（需要自行编写迁移脚本）

由于数据量通常较小（个人 star/fork），建议直接重新同步。

## 故障排查

### 后端启动失败

- 检查 `SESSION_SECRET` 是否设置
- 检查 `PORT` 是否被占用：`lsof -i :3001`
- 检查 `DATABASE_PATH` 目录是否可写

### GitHub OAuth 回调失败

- 确认 OAuth App 的回调 URL 与 `PUBLIC_URL` 匹配
- 确认 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET` 正确
- 查看后端日志获取详细错误

### 同步返回 429

GitHub API 限流。等待一段时间后重试，或配置 OAuth 使用认证请求（限流更宽松）。

### Session 频繁丢失

- 检查 `SESSION_SECRET` 是否变更
- 检查 `COOKIE_SECURE` 设置（HTTP 环境下应为 `false`）
- 检查浏览器是否阻止 cookie
