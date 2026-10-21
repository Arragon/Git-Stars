# Accessibility & real-browser report (M8-10)

Produced by `npm run test:e2e` (Playwright, Chromium, desktop + Pixel 7 projects).
Append a run after each release candidate; this file is evidence, not a promise.

## Checklist covered

- [x] Keyboard-reachable interactive controls expose an accessible name
- [x] No duplicate element ids on the primary page
- [x] No horizontal overflow at 320/390/768/1440/1920
- [x] Core journeys: login, library list, note save + reload, filter return context
- [x] axe automated scan (`@axe-core/playwright`), critical + serious = 0; found and
      fixed a real `label-content-name-mismatch` on the command-palette trigger
- [x] Dialog initial focus + Esc focus restore (batch AI dialog)
- [x] Mobile drawer closed → not focusable; Esc closes and restores the trigger
- [ ] Manual screen-reader pass (drawer, dialogs, tabs)

## Runs

| Date       | Commit                        | Result                                                   | Notes                                                                                                                                        |
| ---------- | ----------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-21 | `m8-followups`                | **29/30 passed** (1 skipped: drawer test is mobile-only) | axe scan added; found + fixed `label-content-name-mismatch` (command-palette trigger); viewport matrix, dialog focus, drawer focus all green |
| 2026-10-21 | `m8-daily-workflow` @ eff7222 | **12/12 passed** (desktop + mobile, 4.7s)                | first green run; caught and fixed a real defect (repository detail crashed on the nested `identity` contract) plus two test-isolation issues |
| 2026-10-21 | `m8-daily-workflow` @ a300cfe | 9/12 (first real run)                                    | failures: repository page white screen (`repo.providerType` undefined), cross-test state pollution (shared seeded DB)                        |
| 2026-10-20 | `m8-daily-workflow` @ 71491bf | infra only                                               | Playwright wired; desktop + mobile projects                                                                                                  |
