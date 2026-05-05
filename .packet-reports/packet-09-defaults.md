# Packet 9 Defaults Chosen

| Default | Value | Rationale |
| --- | --- | --- |
| Site generator | None — hand-written HTML | ~5 pages; SSG/React is overkill; every KB of unnecessary JS is compute the visitor's browser spends |
| CSS framework | None — single custom stylesheet | Framework defaults fight the design; monospace + black/green is simple enough to do by hand |
| Font | System font stack ("Courier New", Courier, monospace) | No external font request, no GDPR footprint, no CDN dep; monospace fits the terminal aesthetic |
| Color palette | #0a0a0a background, #00ff88 accent, #c8d0c8 text | Matches the existing alienclaw.net page; black/green terminal aesthetic; WCAG AA compliant |
| Deploy mechanism | SSH + rsync to Hostinger | Reproducible for any contributor with env vars; no clickwork; idempotent; atomic (--delete-after) |
| Donations | GitHub Sponsors link | No payment processing complexity, no PCI scope, no Stripe dependency; Bugsy controls the Sponsors page |
| Leaderboard | Placeholder HTML table | Real data lands with Packet 10; table columns pre-defined so Packet 10's data layer just fills rows |
| API page | Placeholder with planned endpoints | Spec is locked; server not yet deployed; accurate per LEADERBOARD_API_SPEC.md |
| External trackers | None | Anti-tracking discipline; privacy is a project value; GoatCounter/Plausible may be added later (self-hosted) |
| Site max width | 820px | Readable at 1280px; comfortable at 768px; full-width at 375px mobile |
| Total site size | ≤50 KB (HTML+CSS+favicon) | Environmental thesis applies to the landing page too |
| CI check | Structural integrity (doctype, no external deps) | Machine-enforced anti-tracking and well-formedness; catches regressions immediately |

## Override paths

- Deploy host/user/path: set `ALIENCLAW_DEPLOY_HOST/USER/PATH` env vars
- Sponsors URL: update `donate.html` when Sponsors is set up on GitHub
- Color palette: one CSS file (`site/styles.css`), `:root` custom properties at top
- Add analytics: add a step to `site/styles.css` or use a separate `<script>` tag — but check anti-tracking discipline first
