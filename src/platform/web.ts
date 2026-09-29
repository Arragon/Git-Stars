// src/platform/web.ts
// Web PlatformAdapter — the v1-committed platform implementation of the frozen
// capability contract (ADR-0008 D2/D3). Desktop/mobile adapters are explicitly
// deferred (ADR-0008 D1/D6): there is no half-supported platform state.
//
// Feature code obtains the adapter via getPlatformAdapter() and must degrade by
// capability flags, never by user-agent sniffing.

export type SaveResult =
  | { ok: true; location: "download" }
  | { ok: false; reason: "permission_denied" | "aborted" | "unavailable" };

export interface SharePayload {
  title?: string;
  text?: string;
  url?: string;
}

export interface PlatformAdapter {
  saveFile(name: string, bytes: Uint8Array, mime: string): Promise<SaveResult>;
  openExternal(url: string): Promise<void>;
  deepLink(): {
    supported: boolean;
    register?(handler: (url: string) => void): void;
  };
  secureStorage(): {
    get(k: string): Promise<string | null>;
    set(k: string, v: string): Promise<void>;
  } | null;
  backgroundSync(): { supported: boolean };
  shareSheet(): {
    supported: boolean;
    share?(payload: SharePayload): Promise<void>;
  };
  localCache(): { supported: boolean };
}

// --- Web (v1) implementation ---

async function saveFile(
  name: string,
  bytes: Uint8Array,
  mime: string,
): Promise<SaveResult> {
  // ADR-0008 D3: browser download via Blob anchor. The bytes come from the
  // server-proxied authenticated asset endpoint; the provider token never
  // reaches the client (ADR-0005 D3).
  if (typeof document === "undefined") {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, location: "download" };
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      return { ok: false, reason: "aborted" };
    }
    return { ok: false, reason: "unavailable" };
  }
}

async function openExternal(url: string): Promise<void> {
  if (typeof window === "undefined") return;
  // Only http(s) links are ever handed here; rel=noopener isolates the tab.
  window.open(url, "_blank", "noopener,noreferrer");
}

export const webPlatformAdapter: PlatformAdapter = {
  saveFile,
  openExternal,
  deepLink: () => ({ supported: true }), // URL routes (react-router) are the deep-link surface
  secureStorage: () => null, // session lives in an HttpOnly cookie; no JS-accessible secrets (ADR-0008 D4)
  backgroundSync: () => ({ supported: false }), // sync runs on focus/reconnect (ADR-0008 D4)
  shareSheet: () => ({ supported: false }), // copy-link is the web sharing primitive
  localCache: () => ({ supported: true }), // IndexedDB via src/data (M4)
};
