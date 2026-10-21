// server/lib/repositoryUrl.ts
// Parse a pasted repository URL / "owner/repo" shorthand (M8-02). Only GitHub over
// https/http is accepted; sub-paths (.git, /tree/..., query, hash) are normalized away.

export interface ParsedRepositoryPath {
  providerType: "github";
  host: "github.com";
  namespace: string;
  name: string;
  /** "owner/repo" as used by the provider resolve endpoint. */
  path: string;
}

const OWNER_OR_NAME = /^[A-Za-z0-9_.-]+$/;
const SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseRepositoryUrl(raw: unknown): ParsedRepositoryPath | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value || value.length > 2048) return null;

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    if (!SHORTHAND.test(value)) return null;
    value = `https://github.com/${value}`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const [namespace, rawName] = segments;
  const name = rawName.replace(/\.git$/i, "");
  if (!OWNER_OR_NAME.test(namespace) || !OWNER_OR_NAME.test(name)) return null;

  return {
    providerType: "github",
    host: "github.com",
    namespace,
    name,
    path: `${namespace}/${name}`,
  };
}
