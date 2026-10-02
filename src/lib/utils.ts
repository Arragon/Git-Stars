import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Repo emblem (prototype `repoMark`: tone by name hash + initials) ---

export const REPO_TONES = ["sage", "lilac", "sand", "sky"] as const;

export const TONE_CLASS: Record<string, string> = {
  sage: "bg-brand-soft text-brand-text",
  lilac: "bg-ai-soft text-ai",
  sand: "bg-gold-soft text-gold",
  sky: "bg-info-soft text-info",
};

/** Deterministic emblem (initials + tone class) for a repository name. */
export function repoEmblem(name: string): {
  initials: string;
  tone: (typeof REPO_TONES)[number];
  toneCls: string;
} {
  const initials = (
    name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2) || "??"
  ).toLowerCase();
  const hash = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const tone = REPO_TONES[hash % REPO_TONES.length];
  return { initials, tone, toneCls: TONE_CLASS[tone] };
}
