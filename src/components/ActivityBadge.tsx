// src/components/ActivityBadge.tsx
// Repository activity badge: lazily analyzes commit/issue/PR/release activity
// over the last 30 days via GET /api/github/activity/:owner/:repo when the
// badge scrolls into view, then caches the result per repository (module-level)
// so grids of cards do not refetch.

import React, { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { apiGet } from "../utils/api";

interface ActivityDetails {
  commits: number;
  issues: number;
  prs: number;
  releases: number;
}

interface ActivityResponse {
  index: number;
  details: ActivityDetails;
  partial: boolean;
  analyzedAt: string;
}

const LEVELS: Array<{
  max: number;
  label: string;
  className: string;
}> = [
  {
    max: 0,
    label: "沉寂",
    className:
      "text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700",
  },
  {
    max: 1,
    label: "低活跃",
    className:
      "text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  },
  {
    max: 2,
    label: "中等活跃",
    className:
      "text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800",
  },
  {
    max: 3,
    label: "活跃",
    className:
      "text-green-700 dark:text-green-300 border-green-200 dark:border-green-800",
  },
  {
    max: 4,
    label: "非常活跃",
    className:
      "text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  },
];

function levelFor(index: number) {
  return LEVELS.find((l) => index <= l.max) ?? LEVELS[LEVELS.length - 1];
}

// Module-level per-repo cache: "error" marks a failed analysis (also cached so
// scrolling grids do not hammer the endpoint).
const cache = new Map<string, ActivityResponse | "error">();

export const ActivityBadge: React.FC<{
  owner?: string;
  repo: string;
}> = ({ owner, repo }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [data, setData] = useState<ActivityResponse | null>(() => {
    const cached = owner ? cache.get(`${owner}/${repo}`) : undefined;
    return cached && cached !== "error" ? cached : null;
  });
  const [failed, setFailed] = useState(
    owner ? cache.get(`${owner}/${repo}`) === "error" : true,
  );

  useEffect(() => {
    if (!owner) return;
    const key = `${owner}/${repo}`;
    if (cache.has(key)) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        apiGet<ActivityResponse>(`/api/github/activity/${owner}/${repo}`)
          .then((r) => {
            cache.set(key, r);
            setData(r);
          })
          .catch(() => {
            cache.set(key, "error");
            setFailed(true);
          });
      },
      { rootMargin: "120px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [owner, repo]);

  if (!owner || failed) return null;

  const level = data ? levelFor(data.index) : null;

  return (
    <span ref={ref} className="relative inline-block group">
      {level ? (
        <span
          className={`inline-flex items-center gap-0.5 text-xs border rounded px-1.5 py-0.5 ${level.className}`}
        >
          <Activity className="h-3 w-3" />
          {level.label}
        </span>
      ) : (
        <span className="inline-flex items-center text-xs text-gray-300 dark:text-gray-600 border border-transparent">
          <Activity className="h-3 w-3 animate-pulse" />
        </span>
      )}
      {data && (
        <span className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-1 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded-md bg-gray-900 dark:bg-gray-700 text-white text-xs px-2.5 py-1.5 shadow-lg">
          近 30 天：{data.details.commits} commits · {data.details.prs} PRs ·{" "}
          {data.details.issues} issues · {data.details.releases} releases
          {data.partial && "（部分数据）"}
        </span>
      )}
    </span>
  );
};
