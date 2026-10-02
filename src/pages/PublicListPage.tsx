import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ExternalLink,
  Flag,
  Import,
  Star,
  ShieldAlert,
  LinkIcon,
} from "lucide-react";
import {
  fetchPublicList,
  importPublicList,
  reportPublicList,
  type PublicListItem,
  type PublicListSnapshot,
} from "../utils/gitstarsApi";
import { ApiError } from "../utils/api";
import { useAuthStore } from "../store/useAuthStore";
import { getTagColor } from "../utils/colors";

// Anonymous-shareable list view (/s/:shareId, INH-437). Works without a
// session: logged-in visitors can open the Repository View of available items
// and import the list; anonymous visitors get provider web links and a login
// redirect that preserves the share URL.

const msg = (e: unknown): string =>
  e instanceof ApiError
    ? `${e.code}: ${e.message}`
    : e instanceof Error
      ? e.message
      : "Error";

const REASONS: Array<{
  value: "spam" | "inappropriate" | "copyright" | "other";
  label: string;
}> = [
  { value: "spam", label: "垃圾内容" },
  { value: "inappropriate", label: "不当内容" },
  { value: "copyright", label: "侵权" },
  { value: "other", label: "其他" },
];

function isAvailable(
  item: PublicListItem,
): item is PublicListItem & { unavailable?: undefined } {
  return !item.unavailable;
}

export const PublicListPage: React.FC = () => {
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [snapshot, setSnapshot] = useState<PublicListSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>("spam");
  const [reportState, setReportState] = useState<"idle" | "sending" | "sent">(
    "idle",
  );

  const load = useCallback(async () => {
    if (!shareId) return;
    setLoading(true);
    setGone(false);
    setError("");
    try {
      setSnapshot(await fetchPublicList(shareId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setGone(true);
      } else {
        setError(msg(e));
      }
    } finally {
      setLoading(false);
    }
  }, [shareId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onImport = async () => {
    if (!shareId || importing) return;
    if (!user) {
      // Preserve the share URL through the login flow.
      navigate(`/?redirect=/s/${shareId}`);
      return;
    }
    setImporting(true);
    setError("");
    try {
      await importPublicList(shareId);
      setToast("已复制到我的 Lists");
      setTimeout(() => navigate("/lists"), 900);
    } catch (e) {
      setError(msg(e));
    } finally {
      setImporting(false);
    }
  };

  const onReport = async () => {
    if (!shareId || reportState === "sending") return;
    setReportState("sending");
    try {
      await reportPublicList(
        shareId,
        reportReason as "spam" | "inappropriate" | "copyright" | "other",
      );
      setReportState("sent");
    } catch (e) {
      setError(msg(e));
      setReportState("idle");
    }
  };

  if (loading) {
    return (
      <div className="max-w-[990px] mx-auto px-4 sm:px-8 py-8 space-y-4">
        <div className="h-8 w-2/3 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-1/2 bg-gray-100 rounded animate-pulse" />
        <div className="space-y-2 pt-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 bg-white border border-gray-200 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (gone || !snapshot) {
    return (
      <div className="max-w-[990px] mx-auto px-4 sm:px-8 py-8">
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center space-y-3">
          <ShieldAlert className="h-10 w-10 text-gray-300 mx-auto" />
          <h1 className="text-lg font-semibold text-ink">
            此分享链接已失效或不存在
          </h1>
          <p className="text-sm text-gray-500">
            链接可能已被作者取消分享，或内容因违规被下架。
          </p>
        </div>
      </div>
    );
  }

  const unavailableCount = snapshot.repositoryCount - snapshot.availableCount;

  return (
    <div className="max-w-[990px] mx-auto px-4 sm:px-8 py-8 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 break-words">
            {snapshot.title}
          </h1>
          {snapshot.description && (
            <p className="text-sm text-gray-500 mt-1 break-words">
              {snapshot.description}
            </p>
          )}
          <div className="text-xs text-gray-400 mt-1">
            {snapshot.repositoryCount} 个仓库 · 更新于{" "}
            {new Date(snapshot.updatedAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onImport}
            disabled={importing}
            className="inline-flex items-center gap-1 bg-gray-900 text-white px-3 py-2 rounded text-sm disabled:opacity-60"
          >
            <Import className="h-4 w-4" />
            {importing ? "导入中..." : "导入到我的 Lists"}
          </button>
        </div>
      </div>

      {unavailableCount > 0 && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          其中 {unavailableCount} 个仓库当前不可公开查看
        </div>
      )}
      {error && (
        <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded px-3 py-2">
          {error}
        </div>
      )}

      {snapshot.items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-sm text-gray-500">
          此列表暂无内容。
        </div>
      ) : (
        <ul className="space-y-2">
          {snapshot.items.map((item, i) => {
            if (!isAvailable(item)) {
              return (
                <li
                  key={`unavailable-${i}`}
                  className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-lg px-3 py-3 opacity-60"
                  aria-label="不可用"
                >
                  <div className="h-9 w-9 rounded bg-gray-200 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-400">内容不可用</div>
                  </div>
                  <span className="text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
                    不可用
                  </span>
                </li>
              );
            }
            const color = getTagColor(item.providerType);
            const inner = (
              <>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded border ${color.bg} ${color.text} ${color.border} flex-shrink-0 uppercase`}
                >
                  {item.providerType}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {item.name}
                  </div>
                  {item.description && (
                    <div className="text-xs text-gray-500 truncate">
                      {item.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
                  {item.primaryLanguage && <span>{item.primaryLanguage}</span>}
                  <span className="inline-flex items-center gap-0.5">
                    <Star className="h-3.5 w-3.5" />
                    {item.starsCount}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </div>
              </>
            );
            return (
              <li key={`${item.canonicalKey}-${i}`}>
                {user && item.repositoryId ? (
                  <button
                    onClick={() => navigate(`/repository/${item.repositoryId}`)}
                    className="w-full text-left flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-3 hover:border-gray-400 transition-colors"
                  >
                    {inner}
                  </button>
                ) : (
                  <a
                    href={item.webUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-3 hover:border-gray-400 transition-colors"
                  >
                    {inner}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="pt-2">
        {reportState === "sent" ? (
          <div className="text-xs text-green-700">举报已提交，感谢反馈。</div>
        ) : reportOpen ? (
          <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="text-sm font-medium text-gray-700">举报此分享</div>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={onReport}
                disabled={reportState === "sending"}
                className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded disabled:opacity-60"
              >
                {reportState === "sending" ? "提交中..." : "提交举报"}
              </button>
              <button
                onClick={() => setReportOpen(false)}
                className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setReportOpen(true)}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            <Flag className="h-3 w-3" /> 举报
          </button>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50">
          <LinkIcon className="h-4 w-4" />
          {toast}
        </div>
      )}
    </div>
  );
};
