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
- [x] Accessibility-tree audit (drawer, dialogs, tabs) instead of a manual
      screen-reader pass: `e2e/ax-tree.spec.ts` asserts the roles/names/states a
      screen reader consumes. Residual risk: speech order and verbosity were not
      evaluated by ear — see "Residual risk" below.

## Residual risk

The AX-tree audit proves structure (roles, names, states, presence/absence), not
prosody: announcement order in long lists and verbosity of composed labels still
need one human pass in VoiceOver/NVDA. Recorded as a G8 follow-up rather than a
blocker, because every interactive control is named, every failure state is
announced, and no unnamed control remains on the audited pages.

## Runs

| Date       | Commit                        | Result                                                                                                        | Notes                                                                                                                                        |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-21 | `main` @ bf833a8              | **CI green** — E2E (nightly) run [39551540265](https://github.com/Arragon/Git-Stars/actions/runs/39551540265) | first CI run bound to a build SHA; artifacts: e2e-report + test-results                                                                      |
| 2026-10-21 | `m8-followups`                | **29/30 passed** (1 skipped: drawer test is mobile-only)                                                      | axe scan added; found + fixed `label-content-name-mismatch` (command-palette trigger); viewport matrix, dialog focus, drawer focus all green |
| 2026-10-21 | `m8-daily-workflow` @ eff7222 | **12/12 passed** (desktop + mobile, 4.7s)                                                                     | first green run; caught and fixed a real defect (repository detail crashed on the nested `identity` contract) plus two test-isolation issues |
| 2026-10-21 | `m8-daily-workflow` @ a300cfe | 9/12 (first real run)                                                                                         | failures: repository page white screen (`repo.providerType` undefined), cross-test state pollution (shared seeded DB)                        |
| 2026-10-20 | `m8-daily-workflow` @ 71491bf | infra only                                                                                                    | Playwright wired; desktop + mobile projects                                                                                                  |
