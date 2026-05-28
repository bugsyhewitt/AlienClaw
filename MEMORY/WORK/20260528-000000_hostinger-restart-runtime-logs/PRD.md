---
task: restart api.alienclaw.net and capture runtime logs
slug: 20260528-000000_hostinger-restart-runtime-logs
effort: standard
phase: execute
progress: 0/12
mode: interactive
started: 2026-05-28T00:00:00Z
updated: 2026-05-28T00:00:00Z
---

## Context

Restart the api.alienclaw.net Node.js application on Hostinger hPanel using existing session cookies (/tmp/hostinger_session.json). After restart, navigate to Runtime logs sidebar and extract all visible log text. Also visit Environment variables page and list all env var names. Note any port number visible on dashboard. Screenshots saved to /home/xil/dev/alienclaw/.packet-reports/packet-35-screenshots/ with prefix v8-restart-.

Prior work (v8 screenshots) shows the app has been recently deployed. Session has 65 cookies. This task is purely operational — restart + observe logs, no deployment.

### Risks
- Session may have expired → script stops at login page per instructions
- Restart button may not be directly visible — may need kebab/three-dot menu
- Runtime logs may be empty immediately after restart — 10s wait + second screenshot mitigates
- SPA navigation may require specific element refs vs URLs

## Criteria

- [ ] ISC-1: hpanel.hostinger.com loads without redirecting to login page
- [ ] ISC-2: Screenshot v8-restart-01.png saved after hpanel load
- [ ] ISC-3: api.alienclaw.net Node.js dashboard found and visible
- [ ] ISC-4: Screenshot v8-restart-02.png saved showing app dashboard
- [ ] ISC-5: Restart action identified (button or menu item)
- [ ] ISC-6: Screenshot v8-restart-03.png saved before clicking restart
- [ ] ISC-7: Restart action clicked successfully
- [ ] ISC-8: Screenshot v8-restart-04.png saved after 5s wait post-restart
- [ ] ISC-9: Runtime logs page loaded via sidebar navigation
- [ ] ISC-10: Screenshot v8-restart-05.png saved and log text extracted
- [ ] ISC-11: Screenshot v8-restart-06.png saved after additional 10s wait
- [ ] ISC-12: Environment variables page loaded and env var names listed
- [ ] ISC-13: Screenshot v8-restart-07.png saved showing dashboard port info
- [ ] ISC-14: Screenshot v8-restart-08.png saved showing env vars page

## Decisions

## Verification
