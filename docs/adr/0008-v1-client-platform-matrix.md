# ADR-0008: v1 Client Platform Matrix and Platform-Capability Contract

- Status: Accepted (frozen)
- Date: 2026-09-05
- Linear: [INH-458](https://linear.app/inhandy/issue/INH-458/freeze-v1-client-platform-matrix-and-platform-capability-contract)
- Milestone: M0 - Architecture Contracts
- Depends on: ADR-0001, ADR-0004. Blocks: M6 packaging (contract only, not implemented here).

## Context

The plan must state which client forms v1 actually ships, and each platform's capability
contract for download, file save, deep link, offline storage, and background sync - so
no implementer guesses, and so the "download on phone then transfer to desktop" product
gap is resolved explicitly. Confirmed scope for this effort: **Web only**.

## Decision

### D1. v1 committed client targets

| Target                                           | v1 status                        |
| ------------------------------------------------ | -------------------------------- |
| Web (React SPA, served by the same Hono process) | **Committed**                    |
| Windows desktop                                  | Deferred (contract frozen below) |
| macOS desktop                                    | Deferred (contract frozen below) |
| Mobile (iOS/Android)                             | Deferred (contract frozen below) |

Deferred targets are explicitly marked; there is no half-supported state. UI must not
imply capabilities a committed platform does not have.

### D2. Shared client core vs platform adapter boundary

- **Shared client core** (platform-agnostic, in `src/shared` + `src/features`):
  API client (`src/utils/api.ts`), stores, change-feed consumption (ADR-0004),
  domain view-models, all feature UI. Contains no platform APIs.
- **Platform adapter** (interface `PlatformAdapter`): everything OS-specific.

```ts
interface PlatformAdapter {
  saveFile(name: string, bytes: Uint8Array, mime: string): Promise<SaveResult>;
  openExternal(url: string): Promise<void>;
  deepLink(): { supported: boolean; register?(h: (url: string) => void): void };
  secureStorage(): {
    get(k: string): Promise<string | null>;
    set(k: string, v: string): Promise<void>;
  } | null;
  backgroundSync(): { supported: boolean };
  shareSheet(): {
    supported: boolean;
    share?(payload: SharePayload): Promise<void>;
  };
  localCache(): {
    supported: boolean; /* IndexedDB on web, native store on desktop/mobile */
  };
}
```

Web adapter implementation (v1): `saveFile` = browser download (server-proxied
authenticated URL or Blob anchor); `openExternal` = `window.open`; `deepLink.supported`
= true via URL routes; `secureStorage` = null (session lives in HttpOnly cookie, not JS
storage); `backgroundSync.supported` = false (sync is manual / on-focus); `shareSheet`
= false (use copy-link); `localCache` = IndexedDB (M4).

### D3. Release-asset platform actions

| Action                                    | Web (v1)                                                              | Desktop (deferred) | Mobile (deferred)           |
| ----------------------------------------- | --------------------------------------------------------------------- | ------------------ | --------------------------- |
| direct save                               | browser download via server-proxied authenticated URL (ADR-0005/0006) | native save dialog | save to Files / share sheet |
| open in new tab                           | yes                                                                   | open external      | open external               |
| copy link                                 | yes                                                                   | yes                | yes                         |
| system share sheet                        | no                                                                    | no                 | yes                         |
| cross-device handoff of a downloaded file | **NOT a v1 product capability**                                       | deferred           | deferred                    |

Cross-device file transfer is not a v1 capability; the UI must not imply cloud file
transit. Downloads go straight from the authoritative server to the current device.

### D4. Platform capability matrix

| Capability                | Web (v1)                      | Windows       | macOS          | Mobile            |
| ------------------------- | ----------------------------- | ------------- | -------------- | ----------------- |
| persistent local cache    | IndexedDB (M4)                | native store  | native store   | native store      |
| secure token storage      | HttpOnly cookie (no JS store) | OS keychain   | Keychain       | Keychain/Keystore |
| deep link                 | URL routes                    | custom scheme | universal link | app link          |
| background sync           | no (manual/on-focus)          | yes           | yes            | OS-scheduled      |
| file picker / save dialog | browser download              | native dialog | native dialog  | share/save sheet  |
| system share sheet        | no                            | no            | no             | yes               |
| offline write queue       | M4                            | M4            | M4             | M4                |

### D5. Minimal capability mapping (committed platform -> features)

Web (v1) maps to the minimal capability set for every core module:

- Repository View: read metadata/README/tree/file/releases; download assets (D3).
- Library: list/filter/sort saved repos; save/unsave; note/status/tags.
- Lists: create/edit/reorder/export/import.
- Sync: pull change feed + push mutations while online (ADR-0004); offline queue is M4.

### D6. Deferred capabilities (explicit)

Native packaging/signing/distribution, OS keychain storage, custom-scheme deep links,
background sync, system share sheet, cross-device handoff, offline write queue. These
are frozen at contract level only; M6 packaging implements desktop/mobile from this ADR
without re-deciding the boundary.

## Acceptance (INH-458)

- Windows/macOS download path has an explicit user flow, not "download on phone then
  transfer": D3 (direct save per device; handoff explicitly not v1).
- Each committed platform maps to Repository/Library/Lists/Sync minimal capability: D5.
- Deferred platforms/capabilities are explicitly marked, no half-supported state: D1/D6.
- M6 packaging issue can implement directly from this ADR: D2-D4/D6.
