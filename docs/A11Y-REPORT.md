# Accessibility & real-browser report (M8-10)

Produced by `npm run test:e2e` (Playwright, Chromium, desktop + Pixel 7 projects).
Append a run after each release candidate; this file is evidence, not a promise.

## Checklist covered

- [x] Keyboard-reachable interactive controls expose an accessible name
- [x] No duplicate element ids on the primary page
- [x] No horizontal overflow at the tested viewport
- [x] Core journeys: login, library list, note save + reload, filter return context
- [ ] axe automated scan (follow-up: add `@axe-core/playwright`; current gate uses the
      structural checks above because the dependency is not vendored yet)
- [ ] Manual screen-reader pass (drawer, dialogs, tabs)

## Runs

| Date | Commit | Result | Notes |
| --- | --- | --- | --- |
| 2026-10-21 | `m8-daily-workflow` @ eff7222 | **12/12 passed** (desktop + mobile, 4.7s) | first green run; caught and fixed a real defect (repository detail crashed on the nested `identity` contract) plus two test-isolation issues |
| 2026-10-21 | `m8-daily-workflow` @ a300cfe | 9/12 (first real run) | failures: repository page white screen (`repo.providerType` undefined), cross-test state pollution (shared seeded DB) |
| 2026-10-20 | `m8-daily-workflow` @ 71491bf | infra only | Playwright wired; desktop + mobile projects |
