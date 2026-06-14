---
task: run lighthouse desktop mobile report all values
slug: 20260529-000000_lighthouse-perf-audit
effort: standard
phase: complete
progress: 15/15
mode: interactive
started: 2026-05-29T00:00:00Z
updated: 2026-05-29T00:00:20Z
---

## Context

Run Lighthouse against http://localhost:4444/ twice with exact user-provided commands — desktop preset and mobile default. Extract and report Performance, FCP, LCP, TBT, CLS, JS bootup, Unused JS for both runs.

## Criteria

- [x] ISC-1: Desktop Lighthouse run completes without error
- [x] ISC-2: Mobile Lighthouse run completes without error
- [x] ISC-3: Desktop Performance score extracted and reported
- [x] ISC-4: Desktop FCP value extracted and reported
- [x] ISC-5: Desktop LCP value extracted and reported
- [x] ISC-6: Desktop TBT value extracted and reported
- [x] ISC-7: Desktop CLS value extracted and reported
- [x] ISC-8: Mobile Performance score extracted and reported
- [x] ISC-9: Mobile FCP value extracted and reported
- [x] ISC-10: Mobile LCP value extracted and reported
- [x] ISC-11: Mobile TBT value extracted and reported
- [x] ISC-12: Mobile CLS value extracted and reported
- [x] ISC-13: JS bootup reported for both desktop and mobile
- [x] ISC-14: Unused JS reported for both desktop and mobile
- [x] ISC-A1: Commands not deviated from user-provided spec

## Decisions

## Verification

Both /tmp/lh-desktop.json (496KB) and /tmp/lh-mobile.json (439KB) confirmed present and parseable.
All 7 metrics extracted for both modes. Commands run verbatim from user spec without modification.

Desktop: perf=97, fcp=0.3s, lcp=0.8s, tbt=140ms, cls=0, bootup=572ms, unused-js=23KiB savings
Mobile:  perf=69, fcp=1.0s, lcp=4.2s, tbt=680ms, cls=0, bootup=1280ms, unused-js=23KiB savings
