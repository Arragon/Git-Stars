// src/pages/Settings.tsx
// Pixel-faithful port of the prototype `settings()` (settings-layout +
// settings-nav + settings-panel sections): appearance, AI configuration,
// provider connections, sync/cache state and data/account management.
// All handler logic (AI store, provider revoke/sync, export, two-step account
// deletion, sign-out) is preserved from the previous implementation.

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  Download,
  Eye,
  EyeOff,
  List,
  Monitor,
  RefreshCw,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import {
  confirmAccountDeletion,
  exportAccountData,
  listProviders,
  requestAccountDeletion,
  revokeProvider,
  syncProvider,
  type DeletionRequestResponse,
  type ProviderAccount,
} from "../utils/gitstarsApi";
import { ApiError } from "../utils/api";
import { signOutAndResetLocal } from "../utils/session";
import { useTheme, type ThemePreference } from "../hooks/useTheme";
import { useAuthStore } from "../store/useAuthStore";
import { useAiConfigStore } from "../store/useAiConfigStore";
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { useSyncDrawerStore } from "../store/useSyncDrawerStore";
import { useToastStore } from "../store/useToastStore";
import {
  AI_PROVIDER_PRESETS,
  AI_PROVIDER_GROUP_LABELS,
  getPreset,
  presetSupportsModelListing,
  type AiProviderGroup,
} from "../ai/providers";
import { listAiModels, AiClientError } from "../ai/client";

const msg = (e: unknown): string =>
  e instanceof ApiError ? `${e.code}: ${e.message}` : "操作失败，请重试";

const AI_GROUP_ORDER: AiProviderGroup[] = ["international", "china", "relay"];

const DEFAULT_VIEW_KEY = "gitstars-default-view";

function GitHubGlyph({ className = "ico large" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        d="M9 20c-5 1-5-2-7-3m14 5v-4a3.5 3.5 0 0 0-1-2.8c3.4-.4 7-1.7 7-7.3a5.5 5.5 0 0 0-1.5-3.8A5 5 0 0 0 20 0s-1.3-.4-4 1.5a13 13 0 0 0-8 0C5.3-.4 4 0 4 0a5 5 0 0 0-.5 3.1A5.5 5.5 0 0 0 2 6.9c0 5.6 3.6 6.9 7 7.3A3.5 3.5 0 0 0 8 17v5"
        transform="translate(0 1) scale(.95)"
      />
    </svg>
  );
}

function CodeGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18" />
    </svg>
  );
}

function SyncGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M20 7A8 8 0 0 0 6 5L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5" />
    </svg>
  );
}

function AiGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4" />
    </svg>
  );
}

function ShieldGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6ZM8 12l3 3 5-6" />
    </svg>
  );
}

function SunGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
    </svg>
  );
}

function MoonGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z" />
    </svg>
  );
}

// --- 外观 -------------------------------------------------------------------

const ThemePreview: React.FC<{ t: string }> = ({ t }) => (
  <div className={`theme-preview ${t}`}>
    <div className="mini-side">
      <span />
      <span />
      <span />
    </div>
    <div className="mini-main">
      <span />
      <span />
      <span />
    </div>
  </div>
);

const AppearanceSection: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const showToast = useToastStore((s) => s.showToast);
  const [defaultView, setDefaultView] = useState<"grid" | "list">(() => {
    try {
      const saved = localStorage.getItem(DEFAULT_VIEW_KEY);
      return saved === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });

  const options: Array<{
    value: ThemePreference;
    label: string;
    icon: React.ReactNode;
  }> = [
    { value: "light", label: "浅色", icon: <SunGlyph className="ico small" /> },
    { value: "dark", label: "深色", icon: <MoonGlyph className="ico small" /> },
    {
      value: "system",
      label: "跟随系统",
      icon: <Monitor className="ico small" />,
    },
  ];

  const applyDefaultView = (v: "grid" | "list") => {
    setDefaultView(v);
    try {
      localStorage.setItem(DEFAULT_VIEW_KEY, v);
    } catch {
      // ignore persistence failures
    }
    showToast("默认浏览方式已保存");
  };

  return (
    <>
      <div className="settings-section">
        <h2>外观</h2>
        <p>选择适合当前环境的主题。主题偏好保存在这个浏览器中。</p>
        <div className="theme-options">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`theme-option ${theme === opt.value ? "active" : ""}`}
              aria-pressed={theme === opt.value}
              onClick={() => {
                setTheme(opt.value);
                showToast("主题偏好已更新");
              }}
            >
              <ThemePreview t={opt.value} />
              <span className="row between">
                {opt.label}
                {theme === opt.value ? (
                  <Check className="ico small" />
                ) : (
                  opt.icon
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="setting-row mt16">
          <div>
            <h3>默认浏览方式</h3>
            <p>卡片适合扫览，列表适合快速检索。</p>
          </div>
          <div className="segmented" role="group" aria-label="默认浏览方式">
            {(
              [
                ["grid", "卡片"],
                ["list", "列表"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                className={defaultView === v ? "active" : ""}
                aria-pressed={defaultView === v}
                onClick={() => applyDefaultView(v)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="settings-section">
        <h3>键盘快捷操作</h3>
        <div className="setting-row">
          <span className="small muted">搜索与快捷跳转</span>
          <kbd>⌘ / Ctrl K</kbd>
        </div>
        <div className="setting-row">
          <span className="small muted">聚焦收藏库搜索</span>
          <kbd>/</kbd>
        </div>
        <div className="setting-row">
          <span className="small muted">关闭弹窗与面板</span>
          <kbd>Esc</kbd>
        </div>
      </div>
    </>
  );
};

// --- AI 设置 -----------------------------------------------------------------

const AiSettingsSection: React.FC = () => {
  const { config, setConfig } = useAiConfigStore();
  const showToast = useToastStore((s) => s.showToast);
  const [presetId, setPresetId] = useState(config.presetId);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [language, setLanguage] = useState(
    config.language || "Simplified Chinese",
  );
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>(config.fetchedModels ?? []);
  const [modelsStatus, setModelsStatus] = useState<{
    kind: "idle" | "loading" | "ok" | "error";
    message?: string;
  }>({ kind: "idle" });
  const [validation, setValidation] = useState("");

  const preset = getPreset(presetId);
  const canListModels =
    presetSupportsModelListing(presetId) &&
    apiKey.trim().length > 0 &&
    baseUrl.trim().length > 0;

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    setPresetId(next);
    const nextPreset = getPreset(next);
    if (nextPreset) {
      // 厂商默认配置：Base URL 与默认模型自动填入，用户只需填 API Key。
      setBaseUrl(nextPreset.baseUrl);
      setModel(nextPreset.defaultModel);
    }
    setModels([]);
    setModelsStatus({ kind: "idle" });
  };

  const handleFetchModels = async () => {
    setModelsStatus({ kind: "loading" });
    try {
      const list = await listAiModels({ presetId, baseUrl, apiKey, model });
      setModels(list);
      setModelsStatus({
        kind: "ok",
        message: `获取成功，共 ${list.length} 个模型，可在模型下拉中选择。`,
      });
    } catch (err) {
      const message =
        err instanceof AiClientError
          ? err.message
          : "获取模型列表失败，请手动填写模型名。";
      setModels([]);
      setModelsStatus({ kind: "error", message });
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const apiKeyOk = apiKey.trim().length > 0;
    const baseUrlOk = baseUrl.trim().length > 0;
    const modelOk = model.trim().length > 0;
    if (!apiKeyOk || !baseUrlOk || !modelOk) {
      setValidation("请填写 API Key、Base URL 和模型名。");
      return;
    }
    try {
      const u = new URL(baseUrl);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error();
    } catch {
      setValidation("请使用有效的 HTTP 或 HTTPS 地址。");
      return;
    }
    setValidation("");
    setConfig({
      presetId,
      apiKey,
      baseUrl,
      model,
      language,
      fetchedModels: models.length > 0 ? models : undefined,
    });
    showToast("AI 配置已保存");
  };

  return (
    <form onSubmit={handleSave}>
      <div className="settings-section">
        <div className="row gap8">
          <AiGlyph />
          <h2>AI 设置</h2>
          <span className="badge violet">浏览器本地</span>
        </div>
        <p>按需生成仓库摘要与类别标签。选择厂商后，再填写对应的 API Key。</p>
        <div className="form-grid">
          <label className="field-label">
            厂商 / 服务
            <select
              className="field"
              value={presetId}
              onChange={handlePresetChange}
            >
              {AI_GROUP_ORDER.map((group) => (
                <optgroup key={group} label={AI_PROVIDER_GROUP_LABELS[group]}>
                  {AI_PROVIDER_PRESETS.filter((p) => p.group === group).map(
                    (p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ),
                  )}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field-label">
            API Key
            <span className="key-wrap">
              <input
                className="field"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={preset?.keyPlaceholder ?? "sk-..."}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn icon ghost"
                aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? <EyeOff className="ico" /> : <Eye className="ico" />}
              </button>
            </span>
            <span className="hint">
              仅保存在当前浏览器，不会上传到 GitStars 服务器。
            </span>
          </label>
          <label className="field-label">
            Base URL
            <input
              className="field"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </label>
          <label className="field-label">
            模型
            <span className="key-wrap">
              <input
                className="field"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                list="ai-model-options"
                placeholder={preset?.defaultModel || "模型名"}
                spellCheck={false}
              />
              <datalist id="ai-model-options">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {canListModels && (
                <button
                  type="button"
                  className="btn sm"
                  disabled={modelsStatus.kind === "loading"}
                  onClick={() => void handleFetchModels()}
                >
                  <RefreshCw className="ico small" />
                  {modelsStatus.kind === "loading" ? "获取中…" : "获取列表"}
                </button>
              )}
            </span>
            <span className="hint">支持手动填写模型名。</span>
          </label>
          <label className="field-label">
            摘要语言
            <select
              className="field"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="Simplified Chinese">
                简体中文 (Simplified Chinese)
              </option>
              <option value="Traditional Chinese">
                繁体中文 (Traditional Chinese)
              </option>
              <option value="English">English</option>
              <option value="Japanese">日本語 (Japanese)</option>
              <option value="Korean">한국어 (Korean)</option>
            </select>
          </label>
        </div>
        {preset?.hint && <p className="small muted mt16">{preset.hint}</p>}
        {modelsStatus.kind === "ok" && modelsStatus.message && (
          <p
            className="small mt8"
            style={{ color: "var(--brand-text)" }}
            role="status"
          >
            {modelsStatus.message}
          </p>
        )}
        {modelsStatus.kind === "error" && modelsStatus.message && (
          <p
            className="small mt8"
            style={{ color: "var(--red)" }}
            role="status"
          >
            {modelsStatus.message}
          </p>
        )}
        {validation && (
          <p
            className="small mt16"
            style={{ color: "var(--red)" }}
            role="status"
          >
            {validation}
          </p>
        )}
        <div className="form-actions">
          <span className="small">配置变更后需保存。</span>
          <button className="btn primary" type="submit">
            <Check className="ico" />
            保存配置
          </button>
        </div>
      </div>
      <div className="settings-section">
        <h3>生成摘要时会发送哪些内容？</h3>
        <p>
          仓库名称、描述、主要语言与已有标签会发送给所选模型服务。备注与账号凭据不参与摘要生成。
        </p>
        <p className="small mt8">
          AI Key 按现有实现保存在当前浏览器；设备之间不会自动共享。
        </p>
      </div>
    </form>
  );
};

// --- 平台连接 -----------------------------------------------------------------

const ProvidersSection: React.FC = () => {
  const [providers, setProviders] = useState<ProviderAccount[] | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const showToast = useToastStore((s) => s.showToast);
  const user = useAuthStore((s) => s.user);

  const reload = useCallback(async () => {
    try {
      setProviders(await listProviders());
      setError("");
    } catch (e) {
      setError(msg(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onRevoke = async (p: ProviderAccount) => {
    if (
      !window.confirm(
        `确定解除 ${p.remoteUsername}@${p.host} 的 ${p.providerType} 连接？`,
      )
    ) {
      return;
    }
    setBusyKey(`${p.providerType}:${p.host}`);
    try {
      await revokeProvider(p.providerType, p.host);
      await reload();
      showToast("连接已解除");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusyKey(null);
    }
  };

  const onSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError("");
    try {
      const res = await syncProvider("github");
      showToast(
        res.counts ? `同步完成：${res.counts.repositories} 个仓库` : "同步完成",
      );
    } catch (e) {
      setError(msg(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div className="settings-section">
        <h2>平台连接</h2>
        <p>代码托管平台的授权与同步状态。</p>
        {error && (
          <div className="notice error mt16" role="alert">
            <span className="grow">{error}</span>
          </div>
        )}
        {providers === null ? (
          <p className="muted small mt16">加载中…</p>
        ) : providers.length === 0 ? (
          <p className="muted small mt16">暂无已连接的平台。</p>
        ) : (
          providers.map((p) => (
            <div
              className="provider-row"
              key={`${p.providerType}:${p.host}:${p.remoteUserId}`}
            >
              <span className="provider-symbol">
                <GitHubGlyph />
              </span>
              <div className="grow">
                <div className="row gap8">
                  <h3>GitHub</h3>
                  <span className="badge green">已连接</span>
                </div>
                <p className="muted small mt8">
                  {p.remoteUsername} · {p.host}
                </p>
              </div>
              <button
                type="button"
                className="btn danger sm"
                disabled={busyKey === `${p.providerType}:${p.host}`}
                onClick={() => void onRevoke(p)}
              >
                {busyKey === `${p.providerType}:${p.host}`
                  ? "处理中…"
                  : "解除连接"}
              </button>
            </div>
          ))
        )}
        {["GitLab", "Gitee"].map((p) => (
          <div className="provider-row" key={p}>
            <span className="provider-symbol">
              <CodeGlyph />
            </span>
            <div className="grow">
              <h3>{p}</h3>
              <p className="muted small mt8">当前版本尚未开放真实连接。</p>
            </div>
            <span className="badge">尚未支持</span>
          </div>
        ))}
      </div>
      <div className="settings-section">
        <h3>同步你的收藏</h3>
        <p>
          GitHub 同步会拉取该平台的 Star 与 Fork。整理到 GitStars
          的列表与个人备注由 GitStars 管理。
        </p>
        <div className="form-actions">
          <span className="small">
            {user?.last_synced_at
              ? `上次同步 · ${new Date(user.last_synced_at).toLocaleString()}`
              : "尚未同步过"}
          </span>
          <button
            type="button"
            className="btn primary"
            disabled={!isOnline || syncing}
            title={!isOnline ? "此操作需要联网" : undefined}
            onClick={() => void onSync()}
          >
            <SyncGlyph className="ico" />
            {syncing ? "同步中…" : "同步 GitHub"}
          </button>
        </div>
      </div>
    </>
  );
};

// --- 同步与缓存 ----------------------------------------------------------------

const SyncSection: React.FC = () => {
  const { isOnline, pendingMutationCount, unresolvedConflictCount } =
    useSyncStatusStore();
  const toggleSyncDrawer = useSyncDrawerStore((s) => s.toggle);

  return (
    <div className="settings-section">
      <h2>同步与本地状态</h2>
      <p>查看待上传修改与同步冲突，并在同步抽屉中处理它们。</p>
      <div className="setting-row mt16">
        <div>
          <h3>连接状态</h3>
          <p>
            {isOnline
              ? "连接正常，收藏与列表会自动保持同步。"
              : "当前离线，可继续整理缓存中的收藏。"}
          </p>
        </div>
        <span className={`badge ${isOnline ? "green" : "amber"}`}>
          {isOnline ? "在线" : "离线"}
        </span>
      </div>
      <div className="setting-row">
        <div>
          <h3>待同步修改</h3>
          <p>
            {pendingMutationCount
              ? `${pendingMutationCount} 条更改已保存在本地。`
              : "本地修改已经同步。"}
          </p>
        </div>
        <button type="button" className="btn sm" onClick={toggleSyncDrawer}>
          <List className="ico small" />
          查看队列
        </button>
      </div>
      <div className="setting-row">
        <div>
          <h3>需要处理的冲突</h3>
          <p>
            {unresolvedConflictCount
              ? `${unresolvedConflictCount} 条冲突待处理，可在同步抽屉中查看差异。`
              : "没有待处理的冲突。"}
          </p>
        </div>
        <button type="button" className="btn sm" onClick={toggleSyncDrawer}>
          查看冲突
        </button>
      </div>
    </div>
  );
};

// --- 数据与账户 -----------------------------------------------------------------

const AccountSection: React.FC = () => {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const pendingMutationCount = useSyncStatusStore(
    (s) => s.pendingMutationCount,
  );
  const showToast = useToastStore((s) => s.showToast);

  // Data export
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  // Two-step account deletion
  const [deletion, setDeletion] = useState<DeletionRequestResponse | null>(
    null,
  );
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const onExport = async () => {
    setExporting(true);
    setExportError("");
    try {
      const data = await exportAccountData();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gitstars-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("数据已导出");
    } catch (e) {
      setExportError(msg(e));
    } finally {
      setExporting(false);
    }
  };

  const onRequestDeletion = async () => {
    if (
      !window.confirm(
        "确定要删除账户吗？将生成一个一次性确认令牌，需再次输入才能完成删除。",
      )
    ) {
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      setDeletion(await requestAccountDeletion());
      setDeleteInput("");
    } catch (e) {
      setDeleteError(msg(e));
    } finally {
      setDeleting(false);
    }
  };

  const onConfirmDeletion = async () => {
    const token = deleteInput.trim();
    if (!token || !deletion || token !== deletion.confirmation) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await confirmAccountDeletion(token);
      // Account gone server-side: wipe local caches and return to the entry page.
      await signOutAndResetLocal();
      setUser(null);
      navigate("/");
    } catch (e) {
      setDeleteError(msg(e));
    } finally {
      setDeleting(false);
    }
  };

  const onSignOut = async () => {
    const pending = pendingMutationCount;
    if (
      pending > 0 &&
      !window.confirm(
        `本地还有 ${pending} 条未同步的修改，退出前建议先导出数据。确定退出登录？`,
      )
    ) {
      return;
    } else if (pending === 0 && !window.confirm("确定退出登录？")) {
      return;
    }
    await signOutAndResetLocal();
    setUser(null);
    navigate("/");
  };

  return (
    <div className="settings-section">
      <h2>数据与账户</h2>
      <p>你的收藏、列表和个人整理资料由你管理。</p>
      {exportError && (
        <div className="notice error mt16" role="alert">
          <span className="grow">{exportError}</span>
        </div>
      )}
      <div className="setting-row mt16">
        <div>
          <h3>导出全部数据</h3>
          <p>下载 JSON 格式的收藏、备注、标签与列表。</p>
        </div>
        <button
          type="button"
          className="btn sm"
          disabled={exporting || !isOnline}
          title={!isOnline ? "此操作需要联网" : undefined}
          onClick={() => void onExport()}
        >
          <Download className="ico small" />
          {exporting ? "导出中…" : "导出数据"}
        </button>
      </div>
      <div className="setting-row">
        <div>
          <h3>退出当前账户</h3>
          <p>
            退出后清理当前账户的本地缓存。
            {pendingMutationCount
              ? ` 本地还有 ${pendingMutationCount} 条未同步修改。`
              : ""}
          </p>
        </div>
        <button
          type="button"
          className="btn sm"
          onClick={() => void onSignOut()}
        >
          退出登录
        </button>
      </div>
      <div className="danger-area">
        <h3>删除账户</h3>
        <p className="muted small mt8">
          永久删除账户和所属数据。需要获取一次性确认令牌，再输入令牌完成确认。
        </p>
        {deleteError && (
          <div className="notice error mt16" role="alert">
            <span className="grow">{deleteError}</span>
          </div>
        )}
        {!deletion ? (
          <div className="row between mt16">
            <span className="small muted">建议先导出一份数据备份。</span>
            <button
              type="button"
              className="btn danger sm"
              disabled={deleting || !isOnline}
              title={!isOnline ? "此操作需要联网" : undefined}
              onClick={() => void onRequestDeletion()}
            >
              <Trash2 className="ico small" />
              {deleting ? "处理中…" : "删除账户"}
            </button>
          </div>
        ) : (
          <>
            <p
              className="compare-box mono mt16"
              style={{ userSelect: "all" }}
              role="status"
            >
              {deletion.confirmation}
            </p>
            <label className="field-label mt16">
              确认令牌
              <input
                className="field mono"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder="输入上方确认令牌"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="row between mt16">
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setDeletion(null);
                  setDeleteInput("");
                  setDeleteError("");
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn danger-solid sm"
                disabled={
                  deleting || deleteInput.trim() !== deletion.confirmation
                }
                onClick={() => void onConfirmDeletion()}
              >
                <Trash2 className="ico small" />
                {deleting ? "删除中…" : "永久删除账户"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// --- 页面 ---------------------------------------------------------------------

type SettingsTab = "appearance" | "ai" | "providers" | "sync" | "account";

const SETTINGS_TABS: Array<{
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "appearance", label: "外观", icon: <Sun className="ico" /> },
  { id: "ai", label: "AI 设置", icon: <Sparkles className="ico" /> },
  { id: "providers", label: "平台连接", icon: <GitHubGlyph className="ico" /> },
  { id: "sync", label: "同步与缓存", icon: <SyncGlyph className="ico" /> },
  { id: "account", label: "数据与账户", icon: <ShieldGlyph className="ico" /> },
];

export const Settings: React.FC = () => {
  const [tab, setTab] = useState<SettingsTab>("appearance");

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">
            <h1>设置</h1>
          </div>
          <p>让这个工作空间适合你的使用习惯。</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分组">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "active" : ""}
              aria-current={tab === t.id ? "true" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <section className="settings-panel" aria-label="设置详情">
          {tab === "appearance" && <AppearanceSection />}
          {tab === "ai" && <AiSettingsSection />}
          {tab === "providers" && <ProvidersSection />}
          {tab === "sync" && <SyncSection />}
          {tab === "account" && <AccountSection />}
        </section>
      </div>
    </div>
  );
};
