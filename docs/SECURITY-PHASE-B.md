# PHASE B 安全检查点（B0）：现状、纠正计划与验收不变量

范围：当前 GitHub-only schema。目标是在领域模型迁移（PHASE C/D）之前让部署安全，不重新设计 schema。

## 1. 现状（已核对全部迁移与数据库访问代码）

| # | 问题 | 证据 | 严重度 |
| - | - | - | - |
| 1 | RLS 在 `users` / `projects` / `user_projects` 上被显式关闭，且 `anon`、`authenticated` 被授予 `ALL PRIVILEGES` | `20240101000000_init.sql` | 严重：默认部署的 anon key 可读写删全部业务数据 |
| 2 | `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated` | `20240101000000_init.sql` 末尾 | 严重：后续新建的每张表自动继承客户端全权限（`collections`、`collection_projects` 已受影响，仅因自身启用了 RLS 才未被 anon 读取） |
| 3 | `secure_rls.sql` 没有时间戳前缀，Supabase CLI 静默跳过 | `npx supabase db reset` 输出 `Skipping migration secure_rls.sql...` | 严重：新装与本地 reset 完全没有 RLS 加固；加固只存在于“手工执行过该文件”的实例 |
| 4 | `cleanup_old_users()` / `cleanup_inactive_users()` 直接 `DELETE FROM users`，plpgsql 函数默认 `EXECUTE` 授予 `PUBLIC` | `20240324000000_incremental_sync_and_cleanup.sql` | 严重：任意浏览器会话可经 PostgREST rpc 调用；`users.id` 的 `ON DELETE CASCADE` 会连带删除 `user_projects` 与 `collections` |
| 5 | 同步在 identity 冲突时删除既有用户行 | `src/utils/github.ts` 第 365-376 行 | 严重：自动销毁用户数据（含 cascade 的收藏夹），且删除失败只记日志继续执行 |
| 6 | 浏览器直接写共享 `projects` 行（同步 upsert、AI 摘要、活跃度） | `src/utils/github.ts:466`、`src/pages/Dashboard.tsx:468`、`src/components/ProjectCard.tsx:70`、`src/components/ActivityBadge.tsx:51` | 中：任意 authenticated 用户可改任意仓库事实 |

`users.id` 等于 Supabase Auth 的 subject（`Dashboard.tsx` 用 `user.id` 调用 `syncGitHubData`），因此 `id = auth.uid()` 是有效的所有权谓词。

## 2. 纠正计划（forward-only，不修改已应用的迁移）

1. 新增 `20260831120000_corrective_security_baseline.sql`：
   - 撤销 schema 级 default privileges（问题 2）；
   - 五张业务表全部 `ENABLE ROW LEVEL SECURITY`（问题 1、3）；
   - 先 `REVOKE ALL ... FROM anon, authenticated`，再按需最小授权；`anon` 零授权；
   - `users`：仅 `id = auth.uid()` 的 SELECT/INSERT/UPDATE，**不授予 DELETE**；
   - `user_projects`、`collections`、`collection_projects`：按所有权 CRUD；
   - `projects`：authenticated 可 SELECT/INSERT/UPDATE，**不授予 DELETE**；
   - 全部 policy 用 `DROP POLICY IF EXISTS` 前置，手工执行过 `secure_rls.sql` 的实例可幂等收敛。
2. 新增 `20260831120100_lock_destructive_maintenance.sql`：从 `PUBLIC`、`anon`、`authenticated` 撤销两个 cleanup 函数的 `EXECUTE`（问题 4）。保留函数本体供运维使用。
3. `secure_rls.sql` 移出 `supabase/migrations/`（归档到 `docs/archived/legacy-secure_rls.sql`）。它从未被 CLI 应用，若被手工执行会覆盖上面更严的 policy，因此不能留在迁移目录里。
4. 同步的 identity 冲突路径改为 fail-closed（问题 5，见 B2）：不执行任何 DELETE，中止同步并返回结构化诊断。

### 已知的、本阶段不解决的偏差

问题 6 无法在 B1 完全消除：同步、AI 摘要、活跃度全部在浏览器里写共享 `projects` 行，收紧到“只能写自己 library 内的行”会让首次遇到他人已入库仓库的 upsert 失败，属于破坏现有功能。B1 的处理是**移除 DELETE 能力**（共享事实不可被客户端销毁），列级/服务端边界留给 PHASE D 的 LibraryItem 拆分与 PHASE C 的同步改造。

## 3. 不变量

- I1 任何暴露的业务表都启用 RLS，且客户端角色的权限是显式授予的，不来自 default privileges。
- I2 `anon` 在所有业务表上没有任何权限。
- I3 用户 A 不能读取或写入用户 B 的 `users` / `user_projects` / `collections` / `collection_projects` 行。
- I4 客户端角色不能 DELETE `users` 与 `projects`。
- I5 客户端角色不能执行任何删除用户数据的维护函数。
- I6 用户对自己数据的 CRUD 与现有功能保持可用。
- I7 identity 冲突时同步中止，不执行 DELETE，既有 collections / user_projects 保留。

## 4. 验收测试

数据库（`supabase/tests/database/010_rls_baseline.test.sql`，30 项）：RLS 开启（I1）、anon 五表拒绝（I2）、A/B 隔离与跨用户写入拒绝（I3）、`users`/`projects` DELETE 拒绝（I4）、cleanup 函数权限缺失（I5）、A 自身 CRUD 可用（I6）。

应用（Vitest）：identity 冲突判定返回中止决策而非删除决策（I7）。
