// src/pages/Settings.tsx
// Account settings: appearance (theme), AI configuration, provider
// connections, data export / account deletion and sign-out.

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  Download,
  LogOut,
  Palette,
  Plug,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import {
  confirmAccountDeletion,
  exportAccountData,
  listProviders,
  requestAccountDeletion,
  revokeProvider,
  type DeletionRequestResponse,
  type ProviderAccount,
} from "../utils/gitstarsApi";
import { ApiError } from "../utils/api";
import { signOutAndResetLocal } from "../utils/session";
import { useTheme, type ThemePreference } from "../hooks/useTheme";
import { useAuthStore } from "../store/useAuthStore";
import { useAiConfigStore } from "../store/useAiConfigStore";
import { Notice, PageHeader } from "../components/ui";
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

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ icon, title, description, children }) => (
  <section className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 sm:p-5 space-y-4">
    <div>
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
        {icon}
        {title}
      </h2>
      {description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {description}
        </p>
      )}
    </div>
    {children}
  </section>
);

const AiSettingsSection: React.FC = () => {
  const { config, setConfig } = useAiConfigStore();
  const [presetId, setPresetId] = useState(config.presetId);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [language, setLanguage] = useState(
    config.language || "Simplified Chinese",
  );
  const [models, setModels] = useState<string[]>(config.fetchedModels ?? []);
  const [modelsStatus, setModelsStatus] = useState<{
    kind: "idle" | "loading" | "ok" | "error";
    message?: string;
  }>({ kind: "idle" });
  const [saved, setSaved] = useState(false);

  const preset = getPreset(presetId);
  const canListModels =
    presetSupportsModelListing(presetId) &&
    apiKey.trim().length > 0 &&
    baseUrl.trim().length > 0;

  const apiKeyOk = apiKey.trim().length > 0;
  const baseUrlOk = baseUrl.trim().length > 0;
  const modelOk = model.trim().length > 0;
  const canSave = apiKeyOk && baseUrlOk && modelOk;
  const validationMessage = !apiKeyOk
    ? "API Key 为必填项。"
    : !baseUrlOk
      ? "Base URL 为必填项。"
      : !modelOk
        ? "Model 为必填项。"
        : "";

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
        message: `获取成功，共 ${list.length} 个模型，可在 Model 下拉中选择。`,
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

  const handleSave = () => {
    if (!canSave) return;
    setConfig({
      presetId,
      apiKey,
      baseUrl,
      model,
      language,
      fetchedModels: models.length > 0 ? models : undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const inputClass =
    "mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-800 dark:text-gray-100";

  return (
    <Section
      icon={<Sparkles className="h-4 w-4 text-purple-500" />}
      title="AI 设置"
      description="选择厂商后自动填入默认接口配置，通常只需填写 API Key。用于生成仓库摘要与标签。配置保存在本地浏览器，不会上传服务器。"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
            厂商 / 中转站
          </span>
          <select
            value={presetId}
            onChange={handlePresetChange}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
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

        <label className="block text-sm">
          <span className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
            API Key
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={preset?.keyPlaceholder ?? "sk-..."}
            autoComplete="off"
            className={inputClass}
          />
        </label>

        <label className="block text-sm">
          <span className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
            Base URL
          </span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className={inputClass}
          />
        </label>

        <div className="block text-sm">
          <span className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
            Model
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="ai-model-options"
              placeholder={preset?.defaultModel || "模型名"}
              className={inputClass}
            />
            <datalist id="ai-model-options">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {canListModels && (
              <button
                type="button"
                onClick={() => void handleFetchModels()}
                disabled={modelsStatus.kind === "loading"}
                className="shrink-0 self-stretch px-3 rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 text-xs whitespace-nowrap"
              >
                {modelsStatus.kind === "loading" ? "获取中..." : "获取模型列表"}
              </button>
            )}
          </div>
        </div>

        <label className="block text-sm">
          <span className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
            Summary Language
          </span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
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

      {preset?.hint && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {preset.hint}
        </p>
      )}
      {!canListModels && !preset?.hint && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          该厂商未提供模型列表接口，请手动填写模型名。
        </p>
      )}
      {modelsStatus.kind === "ok" && modelsStatus.message && (
        <p className="text-xs text-green-700 dark:text-green-400">
          {modelsStatus.message}
        </p>
      )}
      {modelsStatus.kind === "error" && modelsStatus.message && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {modelsStatus.message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white ${
            canSave
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-gray-300 dark:bg-gray-700 cursor-not-allowed"
          }`}
        >
          {saved ? (
            <>
              <Check className="h-4 w-4" /> 已保存
            </>
          ) : (
            "保存配置"
          )}
        </button>
        {!canSave && validationMessage && (
          <span className="text-xs text-red-600 dark:text-red-400">
            {validationMessage}
          </span>
        )}
      </div>
    </Section>
  );
};

const ProvidersSection: React.FC = () => {
  const [providers, setProviders] = useState<ProviderAccount[] | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

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
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Section
      icon={<Plug className="h-4 w-4 text-green-600" />}
      title="Provider 连接"
      description="已连接的代码托管平台账号。撤销后需要重新授权才能同步。"
    >
      {error && <Notice tone="error">{error}</Notice>}
      {providers === null ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-2">
          加载中...
        </div>
      ) : providers.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-2">
          暂无已连接的 Provider。
        </div>
      ) : (
        <ul className="space-y-2">
          {providers.map((p) => (
            <li
              key={`${p.providerType}:${p.host}:${p.remoteUserId}`}
              className="flex items-center justify-between gap-3 border border-gray-100 dark:border-gray-800 rounded px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  <span className="uppercase">{p.providerType}</span>
                  <span className="text-green-600 dark:text-green-400 text-xs">
                    已连接
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {p.remoteUsername} @{p.host} · scopes: {p.scopes || "—"}
                </div>
              </div>
              <button
                onClick={() => void onRevoke(p)}
                disabled={busyKey === `${p.providerType}:${p.host}`}
                className="text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/50 px-3 py-1.5 rounded disabled:opacity-50 shrink-0"
              >
                {busyKey === `${p.providerType}:${p.host}`
                  ? "处理中..."
                  : "解除连接"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};

const AppearanceSection: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const options: Array<{ value: ThemePreference; label: string }> = [
    { value: "light", label: "浅色" },
    { value: "dark", label: "深色" },
    { value: "system", label: "跟随系统" },
  ];
  return (
    <Section
      icon={<Palette className="h-4 w-4 text-blue-500" />}
      title="外观"
      description="选择界面的配色主题。"
    >
      <div className="inline-flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            className={`flex-1 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              theme === opt.value
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </Section>
  );
};

type SettingsTab = "appearance" | "ai" | "providers" | "account";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "appearance", label: "外观" },
  { id: "ai", label: "AI 设置" },
  { id: "providers", label: "平台连接" },
  { id: "account", label: "账户" },
];

export const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const [tab, setTab] = useState<SettingsTab>("appearance");

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
    } catch (e) {
      setDeleteError(msg(e));
    } finally {
      setDeleting(false);
    }
  };

  const onConfirmDeletion = async () => {
    const token = deleteInput.trim();
    if (!token) return;
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
    if (!window.confirm("确定退出登录？")) return;
    await signOutAndResetLocal();
    setUser(null);
    navigate("/");
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 text-gray-900 dark:text-gray-100">
      <PageHeader title="Settings" description="外观、AI、平台连接与账户管理" />
      <div className="grid grid-cols-1 min-[721px]:grid-cols-[166px_minmax(0,860px)] gap-5 sm:gap-8 items-start">
        <nav className="grid min-[721px]:sticky min-[721px]:top-[84px] gap-1 min-[721px]:grid-flow-row max-[720px]:grid-flow-col max-[720px]:overflow-auto">
          {SETTINGS_TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`flex items-center gap-2.5 px-3 py-2.5 text-[13px] rounded-[7px] text-left max-[720px]:whitespace-nowrap transition-colors ${
                tab === id
                  ? "bg-brand-soft text-brand-text font-semibold"
                  : "text-muted hover:bg-subtle hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 grid gap-5">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          {user && (
            <p className="text-sm text-gray-500 dark:text-gray-400 -mt-3">
              {user.full_name || user.username}
            </p>
          )}

          {tab === "appearance" && <AppearanceSection />}
          {tab === "ai" && <AiSettingsSection />}
          {tab === "providers" && <ProvidersSection />}

          {tab === "account" && (
            <Section
              icon={<User className="h-4 w-4 text-gray-500" />}
              title="账户"
              description="导出或删除你的全部数据。"
            >
              {exportError && (
                <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded px-3 py-2">
                  {exportError}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void onExport()}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-3 py-2 rounded disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {exporting ? "导出中..." : "导出数据"}
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  下载 JSON 格式的完整数据（收藏、备注、标签、列表、偏好设置）。
                </span>
              </div>

              <div className="border border-red-200 dark:border-red-900 rounded p-3 space-y-3 bg-red-50/50 dark:bg-red-950/30">
                <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4" /> 危险区
                </div>
                {!deletion ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => void onRequestDeletion()}
                      disabled={deleting}
                      className="inline-flex items-center gap-1.5 text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      {deleting ? "处理中..." : "删除账户"}
                    </button>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      两步确认：先获取一次性令牌，输入后才会真正删除。
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      已生成一次性确认令牌。请将它输入到下方输入框以确认删除（令牌仅显示一次）：
                    </div>
                    <code className="block text-xs bg-white dark:bg-gray-800 border border-red-200 dark:border-red-900 rounded p-2 break-all select-all font-mono text-red-700 dark:text-red-300">
                      {deletion.confirmation}
                    </code>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={deleteInput}
                        onChange={(e) => setDeleteInput(e.target.value)}
                        placeholder="粘贴确认令牌"
                        className="flex-1 min-w-48 text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400"
                      />
                      <button
                        onClick={() => void onConfirmDeletion()}
                        disabled={deleting || !deleteInput.trim()}
                        className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded disabled:opacity-50"
                      >
                        {deleting ? "删除中..." : "永久删除账户"}
                      </button>
                      <button
                        onClick={() => {
                          setDeletion(null);
                          setDeleteInput("");
                          setDeleteError("");
                        }}
                        className="text-sm bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
                {deleteError && (
                  <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded px-3 py-2">
                    {deleteError}
                  </div>
                )}
              </div>
            </Section>
          )}

          {tab === "account" && (
            <Section
              icon={<LogOut className="h-4 w-4 text-gray-500" />}
              title="退出登录"
            >
              <button
                onClick={() => void onSignOut()}
                className="text-sm bg-subtle hover:bg-subtle/70 px-3 py-2 rounded"
              >
                退出登录
              </button>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
};
