# G8 · 单人日常工作流验收取证（M8-13 / INH-1724）

逐项取证，不做「整体可用」的主观替代。未完成的项直接写未完成，并注明缺什么证据。

候选构建：`main` @ 17965c9 及其后续文档提交（洁净安装使用 `17965c9`）。

## 汇总

| #   | Checklist 项                                    | 结论    | 证据摘要                                                       |
| --- | ----------------------------------------------- | ------- | -------------------------------------------------------------- |
| 1   | 按文档洁净安装并进入产品                        | PASS    | 全新 clone → `npm ci` → `npm run build` → `npm start` 全通     |
| 2   | 真实 GitHub OAuth 回跳原任务                    | PARTIAL | 回跳链路已实现并单测覆盖；缺真实 OAuth 应用凭据下的人工回跳    |
| 3   | 一次保存/同步、一次真实找回、一次阅读整理       | PASS    | 真实公开仓库 resolve → 保存 → 备注/标签/清单 → README/Releases |
| 4   | 导出 → 全新实例 dry-run → 导入 → 语义比对       | PASS    | dry-run 计数 → apply → 库/备注/标签/清单逐项一致               |
| 5   | 另一日期继续此前任务                            | 未完成  | 依赖 M8-11 的跨日期观察日志（D0 = 2026-11-09）                 |
| 6   | M8-10 核心 journey + 阻断级 a11y 全通过         | PASS    | 38 passed / 2 skipped；axe critical+serious = 0；AX 树审计     |
| 7   | AI 未配置/失败不阻断 Library/Lists/Repo View    | PASS    | E2E「unconfigured AI … library usable」；错误可见且可恢复      |
| 8   | 无 M7 回归（数据丢失/越权/不可恢复队列/不可装） | PASS    | 393 单测（含 M7 全部回归套件）+ E2E 绿                         |

**结论：G8 暂不通过。** 阻断项只有 #5（跨日期观察，时间与真实使用不可替代），以及 #2 的人工回跳确认。其余 6 项已有可复现证据。

## 1. 洁净安装（PASS）

```
git clone https://github.com/Arragon/Git-Stars.git /tmp/g8-install
cd /tmp/g8-install && npm ci            # 279 包，exit 0
npm run build                            # dist/index.html + assets，1.4s
printf 'SESSION_SECRET=…\nLOCAL_DEV_USER=…\nALLOW_DEV_LOGIN=true\n' > .env
npm start
```

结果：`/api/health` 200（`schemaVersion=6`，`schemaCompat=true`）、`/` 200、SPA 路由 `/library` 200 `text/html`、`POST /api/auth/dev-login` 200、`GET /api/account/export` 200。

**本次洁净安装发现并修复了两处真实缺口：**

1. `docs/DEVELOPMENT.md` 未说明 `NODE_ENV=production` 下开发登录还需 `ALLOW_DEV_LOGIN=true`，按文档操作会得到 `DEV_LOGIN_DISABLED`（已补文档）。
2. 该错误的提示语固定写成「LOCAL_DEV_USER is not set」，与实际原因（缺 `ALLOW_DEV_LOGIN`）不符，会误导排障（已按真实原因分支提示）。

## 2. GitHub OAuth 回跳（PARTIAL）

已具备：`/api/auth/github/login?returnTo=…` 生成并入库 state（迁移 v5 `oauth_states`），callback 一次性消费后按 `returnTo` 回跳；`sanitizeReturnTo` 拒绝外站、`//`、控制字符、`/api/`，并有单测。

缺口：仓库未配置真实 `GITHUB_CLIENT_ID/SECRET`，无法完成 GitHub 授权页的真实往返。需要：注册 OAuth App → 在授权页同意 → 确认落回原任务页。这是**人工一次性步骤**，Agent 不能代替点击。

## 3. 真实保存 / 找回 / 阅读整理（PASS）

对真实 GitHub（无 token，公共仓库）执行：

- `POST /api/repositories/resolve {"url":"https://github.com/honojs/hono"}` → `repositoryId`，`canonicalKey=github:github.com/honojs/hono`。
- `POST /api/library {repositoryId}` → saved 记录（version 1）。
- `PUT /api/library/:id` 写入中文备注 → version 2。
- `PUT /api/library/:id/tags/:tagId` 关联标签；`PUT /api/lists/:id/items` 加入清单并写清单备注。
- `GET /api/repositories/:id/readme` → 200，`ref=HEAD`、`sha256=fc976077…`、`fetchedAt`、3650 字符真实 README。
- `GET /api/repositories/:id/releases`（cli/cli）→ 100 条，`v2.103.0` 含 20+ 资产及字节大小。
- `GET /api/repositories/:id/releases/:assetId/download` → 200，1971 字节真实校验和文件（服务端代理，token 不出服务端）。

## 4. 账户导出 / 新实例恢复（PASS）

- 实例 A 导出：`library=2`、`lists=1`（1 item）、`providers=1`、`format=gitstars-account-export`、`schemaVersion=1`。
- 实例 B（空库、新用户 id）dry-run：`repositories=2, savedCreate=2, unresolved=0, tagsCreate=1, tagLinks=1, listsCreate=1, listItems=1`。
- apply 后比对：库 2 条一致；备注文本逐字一致；标签 `g8-演练` 保留；清单「G8 演练清单」含 1 项且清单备注保留。

## 5. 跨日期继续（未完成）

需要 M8-11 的 7–14 天观察日志：至少一次「另一日期继续此前整理」。当前只有同一会话内的证据，不能替代。

## 6. 浏览器与无障碍（PASS）

- E2E：38 passed / 2 skipped（desktop + Pixel 7）。覆盖登录、库列表、备注刷新持久化、筛选往返、可访问名、溢出矩阵、dialog 焦点、drawer 焦点、AX 树审计、AI 未配置不阻断。
- axe：两页 critical + serious = 0。
- 本轮新发现并修复：`<dialog>` 无 accessible name（补 `aria-labelledby`）、命令面板按钮 name 与可见文本不匹配、库页错误提示缺 `role="alert"`。

## 7. AI 未配置不阻断（PASS）

E2E 用例「unconfigured AI shows an error but leaves the library usable」：点击批量摘要后出现 `role="alert"` 错误、Esc 关闭对话框、搜索与列表仍可用。

## 8. M7 回归（PASS）

`npm test` 393 passed（含 M7 的同步、冲突、离线队列、账号隔离、发布快照等套件）；`npm run lint`、`tsc --noEmit`、`prettier --check` 全绿；E2E 绿。

## 关闭 G8 还需要的动作

1. M8-11 观察窗口（D0 2026-11-09，7–14 天），补齐 #5。
2. 在配置了真实 OAuth App 的环境完成一次回跳，补齐 #2。
3. 用本文件作为 INH-1724 的评论附件，逐项勾选后置 Done。
