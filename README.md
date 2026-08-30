# GitStars

一个用于可视化、管理 GitHub Stars & Forks 的 Web 应用：使用 GitHub OAuth 登录后，从 GitHub API 拉取你的 Star/Fork 数据，落库到 Supabase（PostgreSQL），在 Dashboard 中进行检索、筛选、排序，并可选用 AI 生成项目摘要与标签。

## 技术栈

- 前端：React + TypeScript + Vite + Tailwind CSS
- 状态管理：Zustand
- 认证：Supabase Auth（GitHub OAuth）
- 数据库：Supabase Database（PostgreSQL）
- 数据获取：GitHub REST API
- 部署：Vercel（推荐）/ 任意静态托管

## 快速开始（本地开发）

```bash
npm i
cp .env.example .env
npm run dev
```

访问：Vite 输出的本地地址（通常是 `http://localhost:5173/`）。

## 环境变量

本项目为纯前端应用，使用 `VITE_` 前缀的变量会被打包进浏览器侧，因此只应放“可公开”的配置（例如 Supabase `anon` key）。

在项目根目录创建 `.env`：

```bash
VITE_SUPABASE_URL=YOUR_SUPABASE_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

绝对不要把 Supabase `service_role` key 放到浏览器侧，也不要以 `VITE_` 暴露。

## Supabase 配置（数据来源与落库）

### 1) 创建 Supabase 项目

在 Supabase 控制台创建新项目，记下：

- Project URL（对应 `VITE_SUPABASE_URL`）
- `anon` 公钥（对应 `VITE_SUPABASE_ANON_KEY`）

### 2) 配置 GitHub OAuth

在 Supabase 控制台：Authentication → Providers → GitHub

- 创建 GitHub OAuth App（GitHub Developer Settings）
- 将 Client ID / Client Secret 填入 Supabase
- 在 Supabase 的 Redirect URLs 中加入你实际使用的域名

本项目登录会跳转回：`${window.location.origin}/dashboard`，因此至少加入：

- 本地：`http://localhost:5173/dashboard`
- 生产：`https://<你的域名>/dashboard`

### 3) 初始化数据库结构

数据库结构位于 `supabase/migrations/`。你可以通过两种方式应用：

- Supabase CLI（推荐，适合团队协作）
- Supabase Dashboard → SQL Editor（复制粘贴执行）

核心表：

- `users`：绑定 Supabase 用户与 GitHub 身份（`id` 使用 `auth.uid()`）
- `projects`：仓库元信息（GitHub 公共数据）
- `user_projects`：用户与仓库关联（star/fork + 时间）

数据获取与写入的核心逻辑在 [github.ts](file:///d:/Project/GitStars/src/utils/github.ts)。

## 如何获取数据（GitHub → Supabase → UI）

### 1) 登录

首页点击 “Sign in with GitHub” 后，会通过 Supabase 发起 GitHub OAuth：

- 登录入口：[Home.tsx](file:///d:/Project/GitStars/src/pages/Home.tsx)
- OAuth scopes：`read:user user:email`

### 2) 拉取 Stars / Forks

进入 Dashboard 后：

- 优先从 Supabase 读取当前用户的 `user_projects` + 关联的 `projects`
- 如库中无数据，会自动触发一次同步（或用户点击 “Sync Data”）

同步流程（简化）：

- 从 Supabase session 中取 `provider_token` 作为 GitHub API token
- 调用 GitHub API 拉取 stars/forks（最多分页 5 页，约 500 条，避免速率限制）
- 将仓库信息 `upsert` 到 `projects`，将关联关系 `upsert` 到 `user_projects`
- 更新 `users.last_synced_at`

入口页面：[Dashboard.tsx](file:///d:/Project/GitStars/src/pages/Dashboard.tsx)

### 3) 速率限制与失败场景

- GitHub API 可能返回 `403 rate limit`，前端会提示稍后再试
- 首次同步会限制条数，避免一次性请求过多

## 多种部署方式

### 方式 A：Vercel（推荐）

该项目为 SPA，已包含 `vercel.json` 重写规则，支持刷新任意路由。

部署要点：

- 在 Vercel 项目中配置环境变量：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`
- 确保 Supabase 允许的 Redirect URLs 包含你的 Vercel 域名的 `/dashboard`

### 方式 B：静态托管（任意平台）

```bash
npm run build
```

把 `dist/` 上传到静态托管平台，并确保支持 SPA 回退（将所有路径重写到 `index.html`）。

### 方式 C：本地预览构建产物

```bash
npm run build
npm run preview
```

或使用仓库自带脚本启动静态服务器（支持 SPA 回退）：

```bash
python scripts/quick_serve.py --spa
```

## 多种途径访问（使用与数据层）

### 1) Web 访问（最终用户）

- 首页：`/`
- 仪表板：`/dashboard`
- 项目详情：`/project/:id`

### 2) Supabase Dashboard（运维/排障）

- Table Editor：查看 `users/projects/user_projects`
- SQL Editor：执行迁移、排查查询、观察索引

### 3) Supabase REST API（集成/自动化）

Supabase 自动提供 PostgREST：

- 示例：`GET <SUPABASE_URL>/rest/v1/projects?select=*`

安全建议：

- 在生产中仅允许 `authenticated` 访问（配合 RLS）
- 不要在第三方脚本中长期暴露用户 JWT

## 信息安全说明（非常重要）

### 1) 密钥与配置

- `VITE_SUPABASE_ANON_KEY` 会公开到前端，属于“公开密钥”，必须配合 RLS 才安全
- Supabase `service_role` 必须只放在服务端，不得进入浏览器构建
- GitHub OAuth 的 Client Secret 只配置在 Supabase（服务端托管），不得进入前端

### 2) 认证与令牌

- GitHub API token 来自 Supabase 会话的 `provider_token`，用于请求 GitHub API
- 该 token 不应被持久化到你自己的数据库

### 3) 数据库访问控制（RLS）

如果你的 Supabase 表没有启用 RLS 或者给 `anon` 赋予写权限，任何人拿到 `anon` key 都可能直接读写数据库。

本仓库提供了加固迁移：`supabase/migrations/secure_rls.sql`，用于：

- 启用 RLS
- 仅允许 `authenticated` 读写
- 限制 `users/user_projects` 只能访问自己的数据

### 4) AI 功能的安全边界（可选）

Dashboard 支持为项目生成 AI 摘要/标签。当前实现为“浏览器直连模型 API”，即：

- API Key 由用户在页面设置中填写并保存在浏览器端
- 任何前端直连方案都无法完全避免用户侧泄露风险（例如浏览器插件、恶意脚本）

更安全的做法是：将 AI 调用放到你自己的后端（或 Edge Function），由服务端保管密钥。

## 常见问题

### 登录后仍然报错/同步失败

- 检查 Supabase Redirect URLs 是否包含当前域名的 `/dashboard`
- 检查 Supabase Auth → GitHub Provider 是否启用
- GitHub API 可能触发速率限制（`403`）

### 页面刷新 404

这是 SPA 的常见现象，需要托管平台做路由回退到 `index.html`。Vercel 已通过 `vercel.json` 处理。
