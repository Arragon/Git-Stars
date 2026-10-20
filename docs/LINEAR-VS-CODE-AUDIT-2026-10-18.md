# GitStars · Linear 计划 vs 代码实现审计报告

- 审计日期：2026-10-18
- Linear 项目：GitStars（`https://linear.app/inhandy/project/gitstars-bcf16dc90545/overview`，ID `d3c74abd-ddd9-478a-995a-e46ecbca14b8`，Team: Inhandy）
- 代码基线：本地工作区 `/Users/wangdongxin/projects/gitstars`，`main` @ `8a7b988`（merge PR #7 "feature/v1-completion"）
- 信息来源：Linear MCP（项目详情 + 全部 97 张 Issue）；本地代码走查；GitHub Actions（`gh`，经代理）最新 CI 记录；一次可逆实验（临时移开 `.env` 复跑 `npm test`，已还原）

## 一、里程碑总览

| 里程碑                                 | Issue 数            | Linear 状态   | 代码核验结论                                                                                                                                |
| -------------------------------------- | ------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 · Architecture Contracts            | 8                   | 全部 Done     | 与代码一致（ADR-0001～0008 在 `docs/adr/`，契约有落地）                                                                                     |
| M1 · Cloud Core & Identity             | 7                   | 全部 Done     | 与代码一致（skeleton/migrations/auth/凭证保险库/CRUD/mutation+change feed/api:check 均在）                                                  |
| M2 · Providers & Repository View       | 10                  | 全部 Done     | **部分不符**：GitHub 适配器完整；GitLab/Gitee 为 fail-closed stub（INH-354/358 标记 Done）                                                  |
| M3 · Library & Lists                   | 7                   | 全部 Done     | 与代码一致（Library/Lists/Notes/Tags/导入导出 dry-run 均在）                                                                                |
| M4 · Client Cache & Offline Sync       | 7                   | 全部 Done     | 与代码一致（LocalStore/pullSync/mutationQueue/pushReplay/conflictResolvers/conformance 均在）                                               |
| M5 · Sharing & Hub                     | 7                   | 全部 Done     | 与代码一致（publication/share/public/hub/admin takedown/report 均在）                                                                       |
| M6 · Release Hardening                 | 7 Done + 3 Canceled | Done/Canceled | **部分不符**：release manifest 版本传递缺陷（见 M7-09）；schema-breaking gate 缺失（ci.yml 自注 deviation）；原生客户端 Canceled 与代码一致 |
| M7 · Trusted Baseline                  | 15                  | 全部 Todo     | 与代码基本一致（多数确实未完成/仅部分完成，详见逐项表）                                                                                     |
| M8 · Daily Personal Workflow           | 13                  | 全部 Backlog  | 基本一致；3 项已部分先行实现（M8-01/02/05）                                                                                                 |
| M9 · Re-evaluation & Change Validation | 7                   | 全部 Backlog  | 一致（未实现）                                                                                                                              |
| M10 · On-demand Interop & Expansion    | 3 工作包            | 全部 Backlog  | 一致（未实现：无 MCP、无第二 Provider 真实交付、无 PWA）                                                                                    |
| M11 · Conditional External Growth      | 3 工作包            | 全部 Backlog  | 一致（未实现）                                                                                                                              |

## 二、M7 逐项对比（Linear: Todo）

| 任务                                                            | Linear 状态 | 代码实际状态             | 差异说明                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M7-01 · 修复洁净测试环境与当前 CI（INH-1697）                   | Todo        | **未实现（已实测复现）** | main 最新 CI（run 37273719939）Unit tests 失败：`Missing required environment variable: SESSION_SECRET`（server/env.ts:36 ← server/lib/obs.ts:14）。本地移开 `.env` 复跑 `npm test`：266 通过、obs.test.ts 导入即失败、EXIT=1。测试无 env 注入（vite.config.ts 无 test.env；setup.ts 仅 polyfill IndexedDB） |
| M7-02 · 修复单仓库与批量列表归属不误删（INH-1698）              | Todo        | 部分实现                 | 核心 diff 语义已在 `src/pages/Library.tsx` `saveMembership`（逐 list×repo 比较 checked vs member，只提交 add/remove 差异）。缺：逐项部分失败反馈与重试、picker→diff→mutation 集成测试；且直接 `apiPut` 绕过离线 mutation 队列                                                                                |
| M7-03 · 保护退出与账号切换时的未同步修改（INH-1699）            | Todo        | **未实现**               | `src/utils/session.ts` `signOutAndResetLocal()` 无条件调用 `localStore.clearUserState()`，待同步队列/失败草稿未经确认即被清除；服务端 logout 也无相关保护                                                                                                                                                    |
| M7-04 · 修复离线创建 ID 映射与依赖操作恢复（INH-1702）          | Todo        | **未实现**               | `src/data/offlineMutations.ts`、`src/sync/mutationQueue.ts`、`pushReplay.ts` 中未发现临时 ID→服务端 ID 映射、ACK 格式或依赖 payload 重写机制；乐观行使用本地 UUID，依赖 mutation 在重连/重复回放后指向正确实体无保证                                                                                         |
| M7-05 · 实现可续传同步与诚实完成状态（INH-1703）                | Todo        | **未实现**               | `server/services/syncEngine.ts`：`MAX_PAGES = 20` 截断后仍返回 `ok: true` 并推进 `sync_states` cursor（cursor 仅 `{kind, syncedAt}`，非分页游标，无法续传）；无 partial/truncated 标志。代码注释自认 "bounded full reconcile … Add true incremental cursors"                                                 |
| M7-06 · 修正 GitHub Fork 来源契约并建立回归（INH-1700）         | Todo        | **未实现**               | `server/providers/github/index.ts` `listMemberships(kind="fork")` 使用 `GET /users/{username}/repos?type=forks`——`type` 无 `forks` 取值（无效查询语义），且未按 `repo.fork` 过滤，用户仓库列表全部条目会被记为 fork 归属                                                                                     |
| M7-07 · 关闭私有仓库元数据组合授权缺口（INH-1701）              | Todo        | **未实现**               | `server/services/repository.ts` `canViewRepository()` 以 Saved/membership 关联授予私有缓存可见性（正是该 Issue 实现约束所禁止的"通过 Saved 关系提升权限"）；`server/routes/library.ts` `POST /` 仅校验 repository 行存在、无授权判定，且 save 响应直接序列化私有元数据                                       |
| M7-08 · 构建可独立安装的生产服务包（INH-1704）                  | Todo        | **未实现**               | `docs/RELEASE-CHECKLIST.md` 第 4 步为 `npm ci --omit=dev` 后 `npm start`，但 `npm start` = `cross-env NODE_ENV=production tsx server/index.ts`，tsx/cross-env 均为 devDependencies，production-only 安装无法启动                                                                                             |
| M7-09 · 修复 Release manifest、版本与产物来源一致性（INH-1705） | Todo        | **未实现**               | `.github/workflows/release.yml` 未向 `scripts/release-manifest.mjs` 传递 `RELEASE_VERSION`，manifest 版本回退为 package.json `0.0.0`，与 tag 派生产物名（`gitstars-<tag>-server.tar.gz`）及 `server/versions.ts` `APP_VERSION=0.1.0` 三方不一致                                                              |
| M7-10 · 修复 API breaking-change 兼容门禁（INH-1706）           | Todo        | **未实现**               | `scripts/check-api-contract.mjs` `diffBreaking()` 只检测"必填参数/字段被移除、操作/响应/错误码被移除"，未检测"可选→必填"变更（代码注释自认该语义应为 breaking）                                                                                                                                              |
| M7-11 · 实例备份、恢复与升级回滚演练（INH-1709）                | Todo        | 部分实现                 | `docs/runbooks/db-migration-failure.md` 与 RELEASE-CHECKLIST 有备份/恢复流程文档；仓库中未找到真实演练证据（备份→清空→恢复→回滚的记录、实测 RPO/RTO）                                                                                                                                                        |
| M7-12 · 清单顺序及两类备注导入导出守恒（INH-1707）              | Todo        | 部分实现                 | 顺序经 `position` 保序（空库导入 OK）；private 条目按契约排除（`sanitizeItems`）。**缺口**：`list_items.note`（列表条目级备注）不在便携格式（`src/lib/list-format.ts` 仅单一 `item.note` ← `saved_repositories.note`），导出即丢失，"两类备注"不守恒                                                         |
| M7-13 · 统一支持矩阵、安装说明与证据索引（INH-1710）            | Todo        | **未实现**               | `README.md` 仍描述旧本地架构（users/projects/user_projects/collections 表、Dashboard、浏览器直连 AI），与当前 schema（repositories/saved_repositories/lists/…）和云模型不符                                                                                                                                  |
| M7-14 · 修复 Reader 笔记失败反馈与最低草稿保护（INH-1708）      | Todo        | 部分实现                 | `src/pages/RepositoryView.tsx` 备注编辑器经离线队列保存、草稿不丢；但无失败/冲突状态 UI（save-state 恒为成功态文案），乐观 `version+1` 先于服务端确认推进，且"停止输入后自动保存"与实际 onBlur 触发不符                                                                                                      |
| M7-15 · G7 可信基线发布门槛（INH-1711）                         | Todo        | 未开始/当前不可过        | Gate 被 M7-01～14 阻断；且当前 main CI 为红（M7-01），"同一 SHA 全部门禁通过"不成立                                                                                                                                                                                                                          |

## 三、M0–M6 中"标记完成但与代码不符"的项

| 任务                                                                                                   | Linear 状态 | 代码实际状态       | 差异说明                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ----------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INH-354 · Implement GitLab Provider Adapter baseline                                                   | Done        | **仅 stub**        | `server/providers/gitlab/index.ts`：全部方法 `throw notImplemented(...)`，capabilities 全 false。项目描述自认"GitLab/Gitee 当前为 adapter/stub 边界"——Issue 状态与项目口径自相矛盾 |
| INH-358 · Implement Gitee Provider Adapter baseline                                                    | Done        | **仅 stub**        | `server/providers/gitee/index.ts`：同上，fail-closed stub                                                                                                                          |
| INH-498 · Run full-product v1 acceptance across providers, clients, offline sync and sharing           | Done        | **描述与事实不符** | "across providers"不成立（仅 GitHub 真实可用）；"clients"仅 Web（INH-462/466/472 桌面/移动已 Canceled）；offline sync 存在 M7-04/05 未决缺口                                       |
| INH-494 · Build release CI pipeline, versioning, migration checks and distributable artifacts          | Done        | 部分不符           | CI/release 工作流存在且带 migration dry-run；但版本传递缺陷即 M7-09 范围；schema-breaking gate 缺失（ci.yml 注释自认 deviation 并关联 INH-319/INH-494）                            |
| INH-528 · Generate release manifest, artifact checksums and operator/user release documentation        | Done        | 部分不符           | manifest 生成器存在，但版本来源不可追溯（回退 package.json 0.0.0，与 tag/APP_VERSION 0.1.0 不一致）                                                                                |
| INH-319 · Define verification strategy, fixtures and CI quality gates                                  | Done        | 部分不符           | 质量门禁大多落地；schema-breaking gate 未实现（ci.yml 自注 follow-up）                                                                                                             |
| INH-489 · Run release security review across auth, provider secrets, public sharing and client storage | Done        | 需复核             | 与 M7-07（INH-1701，Todo）记录的跨用户私有元数据授权缺口矛盾：安全评审标记完成时该路径已存在。建议复核评审覆盖面与代码基线                                                         |

其余 M0–M6 Done 项经抽查与代码一致：契约冻结（INH-300/304/307/310/312/315/458，ADR-0001～0008）、云核心与身份（INH-323/326/328/333/337/340/512）、GitHub 适配器与 Repository View（INH-346/350/362/365/370/374/378/508）、Library/Lists/Notes/Tags/导入导出（INH-384/387/389/393/395/402/515）、客户端缓存与离线同步（INH-406/410/414/419/422/426/521）、分享与 Hub（INH-431/435/437/443/447/451/524）、账户导出删除/性能/可观测（INH-476/481/485）。Canceled 的 INH-462/466/472（Windows/macOS/移动适配器）与代码一致。

## 四、代码已实现但 Linear 未更新（代码先行/未跟踪）

| 代码中的实现                                            | 位置                                                                   | 对应 Linear 状态 | 说明                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| 列表归属显式 diff 保存                                  | `src/pages/Library.tsx` `saveMembership`                               | M7-02（Todo）    | 核心语义已实现，Issue 仍未更新（但缺失败反馈/测试，属部分实现）            |
| Reader 备注编辑器 + 离线保存                            | `src/pages/RepositoryView.tsx`                                         | M7-14（Todo）    | 编辑器已存在；失败/冲突反馈缺失                                            |
| dev-login `?redirect=` 回跳                             | `src/pages/Home.tsx`                                                   | M8-01（Backlog） | 本地登录已支持回跳原路径（如 `/s/<shareId>`）                              |
| Discover 搜索结果直接保存                               | `src/pages/Library.tsx` `onSaveResult`                                 | M8-02（Backlog） | 搜索→保存链路已实现；URL 粘贴解析仍未实现                                  |
| README 渲染 / Files / Releases / 安全资产下载           | `src/pages/RepositoryView.tsx`、`server/routes/repositories.ts`        | M8-05（Backlog） | 基础能力实际已在 M2（INH-374/378）交付，M8-05 增强点（内容身份等）未见实现 |
| ⌘K 命令面板（页面跳转 + 已保存仓库搜索）                | `src/components/CommandPalette.tsx`                                    | 无对应 Issue     | 未跟踪功能（或可归入 M8-04 查询体验）                                      |
| Collections 自动收藏夹 + 旧 projects/user_projects 表面 | `server/routes/collections.ts`、`server/routes/projects.ts`、legacy 表 | 无对应 Issue     | 旧架构遗留面，新数据模型无跟踪，README 亦未说明其状态                      |

## 五、M8–M11 状态抽查（Backlog）

| 任务                                                                | Linear 状态    | 代码实际状态                 | 差异说明                                                                                                         |
| ------------------------------------------------------------------- | -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| M8-01 · 首次使用与真实 GitHub OAuth 回跳原任务（INH-1712）          | Backlog        | 部分实现                     | dev-login 回跳已有；`server/routes/auth.ts` OAuth callback 固定 `c.redirect("/library")`，无 returnTo/state 回传 |
| M8-02 · URL / Discover 解析后直接保存仓库（INH-1713）               | Backlog        | 部分实现                     | Discover 结果保存已有；URL 粘贴解析无                                                                            |
| M8-05 · Repository View README 保真、内容身份与下载体验（INH-1716） | Backlog        | 部分实现（基础已随 M2 交付） | README markdown 渲染/Releases/安全下载已在；保真度与内容身份增强未见                                             |
| M8-03/04/06/07/08/09/10/11/12/13                                    | Backlog        | 未实现                       | 与状态一致                                                                                                       |
| M9-01～07                                                           | Backlog        | 未实现                       | 与状态一致（候选·未承诺）                                                                                        |
| M10-A 只读 Agent/MCP、M10-B 第二 Provider、M10-C PWA                | Backlog 工作包 | 未实现                       | 无 MCP 服务端、无第二 provider 真实交付、无 PWA manifest/service worker                                          |
| M11-01/02/03                                                        | Backlog 工作包 | 未实现                       | Hub 无策展/订阅增长能力                                                                                          |

## 六、结论摘要

1. **Linear 标记完成但代码中未实现（或仅 stub）**：INH-354（GitLab 适配器）、INH-358（Gitee 适配器）为 fail-closed stub；INH-498（v1 全量验收）的"across providers/clients"表述与事实不符；INH-494/528/319 的版本一致性与 schema-breaking gate 未落地（ci.yml 自认 deviation）；INH-489 安全评审与 M7-07 开放缺口矛盾，需复核。
2. **代码已实现但 Linear 未更新**：M7-02 归属 diff 核心、M7-14 备注编辑器、M8-01 dev-login 回跳、M8-02 Discover 保存、M8-05 的 README/Releases/下载基础（实为 M2 交付）、CommandPalette、Collections 遗留面。
3. **状态描述不一致**：GitLab/Gitee"Done"vs 项目自述"stub 边界"；M6 完成口径与 M7 系统性数据安全/授权/诚实性缺陷之间的张力；README（旧架构）与真实架构不符（M7-13 开放，属已知未决）。
4. **M7 15 项真实进度**：仅部分实现 4 项（M7-02/11/12/14），未实现 10 项，Gate（M7-15）当前不可过——且 main CI 实测为红（SESSION_SECRET），与 M7-01 票面完全吻合。
5. **总体判断**：Linear 的 M7 Todo / M8+ Backlog 状态与代码基本吻合，主要失真集中在 M2/M6 的过度完成标记（provider stub、release 版本链、v1 验收表述）与若干代码先行项。

## 七、建议的下一步处理事项

1. **立即修正 CI（M7-01）**：为测试提供受控 env（vitest `test.env` 或 setup 注入 `SESSION_SECRET` 测试值），保持生产启动对真实密钥的强校验；这是唯一被 CI 实证的阻断项。
2. **回退或重开失真 Done**：将 INH-354/358 改为"契约冻结 + stub"口径（或补齐真实适配切片）；修订 INH-498 表述为"Web + GitHub 主链验收"；将 INH-494/528/319 的版本一致性与 schema gate 缺口显式挂到 M7-09/M7-10。
3. **按依赖顺序推进 M7**：建议 M7-01 → M7-07（安全）→ M7-03/M7-06（数据正确性）→ M7-05/M7-04（同步诚实性）→ M7-08/M7-09/M7-10（发布链）→ M7-02/M7-12/M7-14（剩余部分项）→ M7-11/M7-13 → M7-15 Gate。
4. **更新 Linear 以反映代码先行**：为 M7-02/M7-14 已完成的子目标拆分或记录证据；将 M8-01/02/05 的已交付部分在票面标注，避免重复实现。
5. **清理未跟踪面**：决定 Collections/旧 projects 表面的保留或退役计划并写入 README/支持矩阵（M7-13）；为 CommandPalette 等已交付功能补 Issue 或文档归属。
6. **证据固化**：M7-11 补一次真实备份/恢复/回滚演练并留存记录；G7（M7-15）前在同一候选 SHA 上跑全量门禁并归档 evidence。

## 附录 A：Linear Issue 全量清单（97 张）

| Identifier | 标题                                                                                         | 状态                        | 里程碑 |
| ---------- | -------------------------------------------------------------------------------------------- | --------------------------- | ------ |
| INH-300    | Freeze core domain boundaries and module/package map                                         | Done                        | M0     |
| INH-304    | Freeze normalized repository identity and Provider Adapter contract                          | Done                        | M0     |
| INH-307    | Freeze cloud data model and ownership boundaries                                             | Done                        | M0     |
| INH-310    | Freeze sync protocol, versioning and conflict semantics                                      | Done                        | M0     |
| INH-312    | Freeze authentication, authorization and secret-handling boundary                            | Done                        | M0     |
| INH-315    | Freeze service API surface, error model and compatibility contract                           | Done                        | M0     |
| INH-319    | Define verification strategy, fixtures and CI quality gates                                  | Done                        | M0     |
| INH-458    | Freeze v1 client platform matrix and platform-capability contract                            | Done                        | M0     |
| INH-323    | Bootstrap cloud service workspace, config and health/runtime skeleton                        | Done                        | M1     |
| INH-326    | Implement initial cloud schema migrations and repository/user-state persistence              | Done                        | M1     |
| INH-328    | Implement GitStars account authentication and session lifecycle                              | Done                        | M1     |
| INH-333    | Implement ProviderAccount credential vault, scope validation and revoke flow                 | Done                        | M1     |
| INH-337    | Implement base user-state CRUD APIs for Library, Lists, Tags, Notes and Preferences          | Done                        | M1     |
| INH-340    | Implement server-side mutation versioning, idempotency and change feed                       | Done                        | M1     |
| INH-512    | Generate client API bindings and contract smoke tests from frozen service schema             | Done                        | M1     |
| INH-346    | Implement shared Provider Adapter transport, caching and rate-limit layer                    | Done                        | M2     |
| INH-350    | Implement GitHub Provider Adapter baseline                                                   | Done                        | M2     |
| INH-354    | Implement GitLab Provider Adapter baseline                                                   | Done（实为 stub）           | M2     |
| INH-358    | Implement Gitee Provider Adapter baseline                                                    | Done（实为 stub）           | M2     |
| INH-362    | Implement normalized Repository read service and API aggregation                             | Done                        | M2     |
| INH-365    | Implement Discover search aggregation and provider-aware result normalization                | Done                        | M2     |
| INH-370    | Implement Repository View shell, navigation and Personal summary states                      | Done                        | M2     |
| INH-374    | Implement README renderer and read-only Files/Code browser                                   | Done                        | M2     |
| INH-378    | Implement Releases view and secure release-asset download flow                               | Done                        | M2     |
| INH-508    | Build deterministic cross-provider fixture corpus for adapter conformance tests              | Done                        | M2     |
| INH-384    | Freeze portable Lists/Library export-import format                                           | Done                        | M3     |
| INH-387    | Implement Library screen with cross-provider filter, sort and repository navigation          | Done                        | M3     |
| INH-389    | Implement Repository Personal actions: save, list membership and tags                        | Done                        | M3     |
| INH-393    | Implement Lists management UI and ordered membership editing                                 | Done                        | M3     |
| INH-395    | Implement private Notes editing and Tags management UX                                       | Done                        | M3     |
| INH-402    | Implement Lists/Library export and import engine with dry-run preview                        | Done                        | M3     |
| INH-515    | Build golden export-import fixture suite and round-trip regression tests                     | Done                        | M3     |
| INH-406    | Implement shared client data layer and local cache schema                                    | Done                        | M4     |
| INH-410    | Implement incremental pull sync and local replica reconciliation                             | Done                        | M4     |
| INH-414    | Implement durable offline mutation queue and push replay engine                              | Done                        | M4     |
| INH-419    | Implement entity-specific sync conflict resolvers and conflict audit surface                 | Done                        | M4     |
| INH-422    | Implement offline/sync status UX and recoverable conflict/error actions                      | Done                        | M4     |
| INH-426    | Build deterministic multi-client sync conformance and crash-recovery test suite              | Done                        | M4     |
| INH-521    | Implement deterministic in-memory client store and network-fault test drivers                | Done                        | M4     |
| INH-431    | Implement sanitized public List snapshot model and publication boundary                      | Done                        | M5     |
| INH-435    | Implement List share publish/revoke APIs and share-link lifecycle                            | Done                        | M5     |
| INH-437    | Implement public shared-List page and import/copy action                                     | Done                        | M5     |
| INH-443    | Implement Hub publication catalog, search and discovery API                                  | Done                        | M5     |
| INH-447    | Implement Hub browse/detail UI and one-click copy to Lists                                   | Done                        | M5     |
| INH-451    | Add minimum public-service abuse controls, reporting and takedown path                       | Done                        | M5     |
| INH-524    | Build public Share/Hub seed fixtures and anonymous smoke-test suite                          | Done                        | M5     |
| INH-462    | Implement Windows desktop platform adapter, packaging and native download/save integration   | Canceled                    | M6     |
| INH-466    | Implement macOS desktop platform adapter, packaging and native download/save integration     | Canceled                    | M6     |
| INH-472    | Implement committed mobile platform adapter(s), native share and download handoff            | Canceled                    | M6     |
| INH-476    | Implement user data export, account deletion and recovery-safe deletion workflow             | Done                        | M6     |
| INH-481    | Profile and harden performance, cache behavior and provider-rate-limit resilience            | Done                        | M6     |
| INH-485    | Add production observability, audit-safe logging and operational runbooks                    | Done                        | M6     |
| INH-489    | Run release security review across auth, provider secrets, public sharing and client storage | Done（需复核）              | M6     |
| INH-494    | Build release CI pipeline, versioning, migration checks and distributable artifacts          | Done（部分不符）            | M6     |
| INH-498    | Run full-product v1 acceptance across providers, clients, offline sync and sharing           | Done（描述不符）            | M6     |
| INH-528    | Generate release manifest, artifact checksums and operator/user release documentation        | Done（部分不符）            | M6     |
| INH-1697   | M7-01 · 修复洁净测试环境与当前 CI                                                            | Todo（未实现，CI 实证）     | M7     |
| INH-1698   | M7-02 · 修复单仓库与批量列表归属不误删                                                       | Todo（部分实现）            | M7     |
| INH-1699   | M7-03 · 保护退出与账号切换时的未同步修改                                                     | Todo（未实现）              | M7     |
| INH-1702   | M7-04 · 修复离线创建 ID 映射与依赖操作恢复                                                   | Todo（未实现）              | M7     |
| INH-1703   | M7-05 · 实现可续传同步与诚实完成状态                                                         | Todo（未实现）              | M7     |
| INH-1700   | M7-06 · 修正 GitHub Fork 来源契约并建立回归                                                  | Todo（未实现）              | M7     |
| INH-1701   | M7-07 · 关闭私有仓库元数据组合授权缺口                                                       | Todo（未实现）              | M7     |
| INH-1704   | M7-08 · 构建可独立安装的生产服务包                                                           | Todo（未实现）              | M7     |
| INH-1705   | M7-09 · 修复 Release manifest、版本与产物来源一致性                                          | Todo（未实现）              | M7     |
| INH-1706   | M7-10 · 修复 API breaking-change 兼容门禁                                                    | Todo（未实现）              | M7     |
| INH-1709   | M7-11 · 实例备份、恢复与升级回滚演练                                                         | Todo（部分实现）            | M7     |
| INH-1707   | M7-12 · 清单顺序及两类备注导入导出守恒                                                       | Todo（部分实现）            | M7     |
| INH-1708   | M7-14 · 修复 Reader 笔记失败反馈与最低草稿保护                                               | Todo（部分实现）            | M7     |
| INH-1710   | M7-13 · 统一支持矩阵、安装说明与证据索引                                                     | Todo（未实现）              | M7     |
| INH-1711   | M7-15 · G7 可信基线发布门槛                                                                  | Todo（未开始）              | M7     |
| INH-1712   | M8-01 · 首次使用与真实 GitHub OAuth 回跳原任务                                               | Backlog（部分先行）         | M8     |
| INH-1713   | M8-02 · URL / Discover 解析后直接保存仓库                                                    | Backlog（部分先行）         | M8     |
| INH-1714   | M8-03 · 搜索数据流与在线/离线字段语义一致                                                    | Backlog                     | M8     |
| INH-1715   | M8-04 · 保留查询、筛选、滚动与 Repository View 返回上下文                                    | Backlog                     | M8     |
| INH-1716   | M8-05 · Repository View README 保真、内容身份与下载体验                                      | Backlog（基础已随 M2 交付） | M8     |
| INH-1717   | M8-06 · 笔记草稿、标签与 Lists 的低成本整理体验                                              | Backlog                     | M8     |
| INH-1718   | M8-08 · AI 任务可终止、可恢复且密钥生命周期明确                                              | Backlog                     | M8     |
| INH-1719   | M8-09 · 实现完整账户便携恢复                                                                 | Backlog                     | M8     |
| INH-1720   | M8-12 · 分享快照状态、复制与公开语义完善                                                     | Backlog                     | M8     |
| INH-1721   | M8-07 · AI 摘要来源与不确定性表达（条件增强）                                                | Backlog                     | M8     |
| INH-1722   | M8-10 · 真实浏览器与可访问性阻断验收                                                         | Backlog                     | M8     |
| INH-1723   | M8-11 · 本人 7–14 天真实任务使用验证                                                         | Backlog                     | M8     |
| INH-1724   | M8-13 · G8 单人日常工作流验收门槛                                                            | Backlog                     | M8     |
| INH-1725   | M9-01 · 用真实任务验证用途/决定模板                                                          | Backlog                     | M9     |
| INH-1726   | M9-02 · 最小关注集合与来源新旧状态                                                           | Backlog                     | M9     |
| INH-1727   | M9-03 · 两轮有来源的仓库变化摘要试验                                                         | Backlog                     | M9     |
| INH-1728   | M9-04 · 轻量复评入口与处理状态                                                               | Backlog                     | M9     |
| INH-1729   | M9-05 · 少量候选仓库比较（2–5 个）                                                           | Backlog                     | M9     |
| INH-1730   | M9-06 · 私人决策上下文导出                                                                   | Backlog                     | M9     |
| INH-1731   | M9-07 · G9 复评与变化价值门槛                                                                | Backlog                     | M9     |
| INH-1732   | M10-A · 只读 Agent / MCP 互联工作包                                                          | Backlog                     | M10    |
| INH-1733   | M10-B · 第二 Provider 真实交付工作包                                                         | Backlog                     | M10    |
| INH-1734   | M10-C · PWA 与选择性离线内容工作包                                                           | Backlog                     | M10    |
| INH-1735   | M11-01 · 托管与安装便利验证工作包                                                            | Backlog                     | M11    |
| INH-1736   | M11-02 · 轻协作需求验证工作包                                                                | Backlog                     | M11    |
| INH-1737   | M11-03 · Hub 策展/订阅增长验证工作包                                                         | Backlog                     | M11    |

## 附录 B：关键代码位置索引

- GitHub 适配器（fork 查询语义）：`server/providers/github/index.ts`（`listMemberships`）
- GitLab/Gitee stub：`server/providers/gitlab/index.ts`、`server/providers/gitee/index.ts`
- 同步引擎（MAX_PAGES/截断即成功）：`server/services/syncEngine.ts`
- 私有仓库缓存可见性：`server/services/repository.ts`（`canViewRepository`）
- Save API 无授权检查：`server/routes/library.ts`（`POST /`）
- 登出即清本地状态：`src/utils/session.ts`（`signOutAndResetLocal`）
- 归属 diff 保存：`src/pages/Library.tsx`（`saveMembership`）
- 便携 List 格式（单一 note）：`src/lib/list-format.ts`；导入导出：`server/services/listsIo.ts`
- API 契约门禁（缺 可选→必填 检测）：`scripts/check-api-contract.mjs`
- Release 版本链：`.github/workflows/release.yml`、`scripts/release-manifest.mjs`、`server/versions.ts`、`package.json`
- CI 现状（红）：`.github/workflows/ci.yml`；GitHub run 37273719939（Unit tests 失败）
