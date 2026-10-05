// src/pages/PublicListPage.tsx
// Anonymous-shareable list view (/s/:shareId, INH-437). Pixel-faithful port of
// the prototype `publicList()` + `reportDialog()`. Works without a session:
// logged-in visitors can open the Repository View of available items and import
// the list; anonymous visitors get provider web links and a login redirect that
// preserves the share URL.

import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  Folder,
  Globe,
  Lock,
  Plus,
  Shield,
  Star,
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
import { useSyncStatusStore } from "../store/useSyncStatusStore";
import { useToastStore } from "../store/useToastStore";
import { Dialog, EmptyState, SkeletonCard } from "../components/ui";
import { repoEmblem } from "../lib/utils";

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
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const showToast = useToastStore((s) => s.showToast);

  const [snapshot, setSnapshot] = useState<PublicListSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
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
      showToast("已经创建私有副本");
      setTimeout(() => navigate("/lists"), 700);
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
      setReportOpen(false);
      showToast("举报已提交，谢谢你的反馈");
    } catch (e) {
      setError(msg(e));
      setReportState("idle");
    }
  };

  if (loading) {
    return (
      <div className="public-content">
        <div className="repo-grid" role="status" aria-label="正在加载">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (gone || !snapshot) {
    return (
      <div className="public-content" style={{ paddingTop: 85 }}>
        <EmptyState
          icon={<Shield className="ico large" />}
          title="此分享链接已失效或不存在"
          description="链接可能已被取消，或当前无法访问。你可以继续浏览其他公开清单。"
          action={
            <Link to="/hub" className="btn primary">
              浏览 Hub
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="public-content">
      <Link to="/hub" className="row small muted gap8">
        <svg className="ico small" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 12H5m5-5-5 5 5 5" />
        </svg>
        返回 Hub
      </Link>
      <section className="public-head mt24">
        <div className="row between wrap">
          <div className="row gap8">
            <span className="badge green">
              <Globe className="ico small" />
              公开分享
            </span>
            <span className="badge">独立快照</span>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={importing || !isOnline}
            title={!isOnline ? "此操作需要联网" : undefined}
            onClick={() => void onImport()}
          >
            <Plus className="ico" />
            {importing
              ? "复制中…"
              : user
                ? "复制到我的列表"
                : "登录后复制到我的列表"}
          </button>
        </div>
        <h1>{snapshot.title}</h1>
        {snapshot.description && <p>{snapshot.description}</p>}
        <div className="public-meta">
          <span className="row gap8">
            <Folder className="ico small" />
            {snapshot.repositoryCount} 个条目
          </span>
          <span className="row gap8">
            <Clock className="ico small" />
            {new Date(snapshot.updatedAt).toLocaleDateString()} 更新
          </span>
          <span>不会跟随作者后续编辑自动更新</span>
        </div>
      </section>

      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle className="ico" />
          <span className="grow">{error}</span>
        </div>
      )}

      {snapshot.items.length === 0 && (
        <EmptyState
          icon={<Folder className="ico large" />}
          title="此列表暂无内容"
        />
      )}

      {snapshot.items.map((item, i) => {
        if (!isAvailable(item)) {
          return (
            <div className="public-item unavailable" key={`unavailable-${i}`}>
              <Lock className="ico large" />
              <div className="grow">
                <h3>仓库不可用</h3>
                <p>该条目当前无法公开展示。</p>
              </div>
              <span className="badge">不可用</span>
            </div>
          );
        }
        const emblem = repoEmblem(item.name);
        const fullName = item.name;
        return (
          <article className="public-item" key={`${item.canonicalKey}-${i}`}>
            <span className={`repo-emblem ${emblem.toneCls}`}>
              {emblem.initials}
            </span>
            <div className="grow">
              <h3>
                {user && item.repositoryId ? (
                  <Link to={`/repository/${item.repositoryId}`}>
                    {fullName}
                  </Link>
                ) : (
                  <a
                    href={item.webUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {fullName}
                  </a>
                )}
              </h3>
              {item.description && <p>{item.description}</p>}
              <div className="row muted tiny mt8" style={{ gap: 13 }}>
                {item.primaryLanguage && (
                  <span className="row gap8">
                    <span
                      className="lang-dot"
                      style={{ background: "var(--muted)" }}
                    />
                    {item.primaryLanguage}
                  </span>
                )}
                <span className="row gap8 number">
                  <Star className="ico small" /> {item.starsCount}
                </span>
              </div>
            </div>
            <a
              className="btn icon ghost"
              href={item.webUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`在来源平台打开 ${item.name}`}
            >
              <ExternalLink className="ico" />
            </a>
          </article>
        );
      })}

      <div className="public-foot">
        <span>分享仅展示公开仓库资料，个人备注与 AI 内容不在快照中。</span>
        <button
          type="button"
          className="btn ghost sm"
          disabled={!isOnline}
          title={!isOnline ? "此操作需要联网" : undefined}
          onClick={() => {
            setReportReason("spam");
            setReportOpen(true);
          }}
        >
          <AlertTriangle className="ico small" />
          举报内容
        </button>
      </div>
      {reportState === "sent" && (
        <p className="small muted mt8" role="status">
          举报已提交，感谢反馈。
        </p>
      )}

      {/* Report dialog (prototype `reportDialog`) */}
      <Dialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="举报公开内容"
      >
        <p>选择与当前内容有关的举报原因。</p>
        <div className="check-list">
          {REASONS.map((r) => (
            <label key={r.value}>
              <input
                type="radio"
                name="report-reason"
                value={r.value}
                checked={reportReason === r.value}
                onChange={() => setReportReason(r.value)}
              />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
        <div className="row mt16" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn"
            onClick={() => setReportOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={reportState === "sending"}
            onClick={() => void onReport()}
          >
            <Shield className="ico" />
            {reportState === "sending" ? "提交中…" : "提交举报"}
          </button>
        </div>
      </Dialog>
    </div>
  );
};
