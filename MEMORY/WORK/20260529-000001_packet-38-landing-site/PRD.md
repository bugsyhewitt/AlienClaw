---
task: packet 38 alienclaw.net landing site build deploy
slug: 20260529-000001_packet-38-landing-site
effort: comprehensive
phase: execute
progress: 0/97
mode: interactive
started: 2026-05-29T00:00:00Z
updated: 2026-05-29T00:00:00Z
---

## Context

Engineering arc closed at Packet 37.1. api.alienclaw.net is live. alienclaw.net has
nothing — strangers landing from Reddit see a placeholder. This packet builds the
marketing site that makes AlienClaw legible in 5 seconds, credible in 30.

New sibling repo ~/dev/alienclaw-site/ (separate from engine repo — different deploy
target, different release cadence, cleaner identity). Static Next.js export served by
Hostinger's primary domain public_html. Logo at ~/Downloads/alienclaw.png. Eyedropped
lime green: #C8E731.

**Design:** playful-serious. Cartoon mascot as visual anchor. Off-white canvas, lime
green accent, Inter body, Space Grotesk display. Generous whitespace. Framer Motion
spring physics. Genome unscramble as the standout interactive moment.

**Proof gate:** Lighthouse Performance ≥ 90, Accessibility ≥ 95.
**Never list:** no api.alienclaw.net changes, no tracking, no brand wall violations,
no third font, no linear easing, no PR self-merge.

### Risks

- pnpm create next-app may prompt interactively — must use --yes flags or pipe
- Lighthouse scores on static export may need image optimization tuning
- API leaderboard endpoint URL format needs verification before widget build
- SSL on alienclaw.net may need hPanel provisioning if not already active
- Framer Motion bundle size may push Performance below 90 — code-split aggressively
- Hostinger public_html for primary domain may differ from api subdomain structure

## Criteria

### Phase 1 — Repo + Scaffold
- [ ] ISC-1: ~/dev/alienclaw-site/ created and git initialized on main branch
- [ ] ISC-2: Next.js App Router + TypeScript scaffolded with pnpm
- [ ] ISC-3: next.config.mjs has output: 'export'
- [ ] ISC-4: next.config.mjs has images: { unoptimized: true }
- [ ] ISC-5: next.config.mjs has trailingSlash: true
- [ ] ISC-6: framer-motion installed in dependencies
- [ ] ISC-7: lucide-react installed in dependencies
- [ ] ISC-8: clsx and tailwind-merge installed
- [ ] ISC-9: shadcn/ui initialized (components.json present)
- [ ] ISC-10: shadcn button, card, badge, skeleton components added
- [ ] ISC-11: GitHub repo bugsyhewitt/alienclaw-site created and initial commit pushed
- [ ] ISC-12: packet-38-landing-site branch created

### Phase 2 — Packet contract
- [ ] ISC-13: .claude-code directory replicated from engine repo
- [ ] ISC-14: locked-decisions.md has site-specific section (Next.js, static export, brand wall)
- [ ] ISC-15: packets/packet-38-landing-site.md stub committed

### Phase 3 — Design tokens
- [ ] ISC-16: logo copied to src/app/assets/logo.png
- [ ] ISC-17: tailwind.config.ts has slime.DEFAULT: '#C8E731' (eyedropped hex)
- [ ] ISC-18: tailwind.config.ts has slime.dark, slime.light, slime.glow variants
- [ ] ISC-19: tailwind.config.ts has canvas: '#FAFAF8' color token
- [ ] ISC-20: tailwind.config.ts has ink: '#1A1A1A' and muted: '#6B6B6B' tokens
- [ ] ISC-21: tailwind.config.ts has slime-drip keyframe (translateY 0 → 3px loop)
- [ ] ISC-22: tailwind.config.ts has ufo-bob keyframe (translateY 0 → -3px loop)
- [ ] ISC-23: tailwind.config.ts references Inter and Space Grotesk CSS variables
- [ ] ISC-24: layout.tsx loads Inter via next/font with variable --font-inter
- [ ] ISC-25: layout.tsx loads Space Grotesk via next/font with variable --font-space-grotesk
- [ ] ISC-26: layout.tsx metadata has title, description, and OG fields
- [ ] ISC-27: body element has bg-canvas text-ink font-sans antialiased classes

### Phase 4 — Page architecture
- [ ] ISC-28: src/app/page.tsx exists (landing route)
- [ ] ISC-29: src/app/leaderboard/page.tsx exists
- [ ] ISC-30: src/app/docs/page.tsx exists
- [ ] ISC-31: src/app/components/Nav.tsx exists
- [ ] ISC-32: src/app/components/Hero.tsx exists
- [ ] ISC-33: src/app/components/Mascot.tsx exists
- [ ] ISC-34: src/app/components/HowItWorks.tsx exists
- [ ] ISC-35: src/app/components/LeaderboardWidget.tsx exists
- [ ] ISC-36: src/app/components/LeaderboardFull.tsx exists
- [ ] ISC-37: src/app/components/VideoPlaceholder.tsx exists
- [ ] ISC-38: src/app/components/Footer.tsx exists
- [ ] ISC-39: pnpm dev starts without TypeScript errors

### Phase 5 — Landing page sections
- [ ] ISC-40: Nav has logo (40px mascot) + wordmark on left
- [ ] ISC-41: Nav has Leaderboard, Docs, GitHub links
- [ ] ISC-42: Nav becomes sticky with backdrop-blur after 100px scroll
- [ ] ISC-43: Nav has mobile hamburger → sheet drawer
- [ ] ISC-44: Hero eyebrow text present (OPEN SOURCE · EVOLUTIONARY AI · MIT)
- [ ] ISC-45: Hero headline uses display font at ~64px desktop (3-line layout)
- [ ] ISC-46: Hero sub-headline present (24px, muted color)
- [ ] ISC-47: Hero primary CTA: Submit a genome (slime green button)
- [ ] ISC-48: Hero secondary CTA: Star on GitHub (ghost button with external link)
- [ ] ISC-49: Hero live stat row fetches from API with graceful — fallback
- [ ] ISC-50: Mascot renders with slime-drip animation class applied
- [ ] ISC-51: Mascot renders with ufo-bob animation class applied
- [ ] ISC-52: Hero entrance: text staggers in, mascot drops from -40px, all within 800ms
- [ ] ISC-53: HowItWorks genome string is 256 chars of Base62 in monospace grid
- [ ] ISC-54: HowItWorks scramble animation triggers on scroll into view (useInView)
- [ ] ISC-55: HowItWorks fitness meter fills 0.000 → 0.872 alongside genome settle
- [ ] ISC-56: HowItWorks 3-step cards present: Compose, Evolve, Share
- [ ] ISC-57: Each step card has lucide icon (Dna, Sparkles, Trophy) tinted lime
- [ ] ISC-58: Step cards have hover lift (translateY -4px, shadow increase)
- [ ] ISC-59: LeaderboardWidget fetches api.alienclaw.net/v1/genomes/top?martian_type=search_text_alone&limit=5
- [ ] ISC-60: LeaderboardWidget renders skeleton while loading
- [ ] ISC-61: LeaderboardWidget renders graceful empty state if no data
- [ ] ISC-62: LeaderboardWidget rows stagger in with Framer Motion
- [ ] ISC-63: VideoPlaceholder has 16:9 aspect ratio with play button overlay
- [ ] ISC-64: VideoPlaceholder accepts videoUrl prop and renders video when provided
- [ ] ISC-65: Footer has 3-column layout (mascot+tagline, links, credits)
- [ ] ISC-66: Footer has slime-green top border (1px)
- [ ] ISC-67: All 6 sections composed in src/app/page.tsx
- [ ] ISC-68: prefers-reduced-motion disables all Framer Motion animations

### Phase 6 — Leaderboard + Docs + OG
- [ ] ISC-69: /leaderboard page renders tabs by martian type
- [ ] ISC-70: /leaderboard rows have hover tooltip with genome string
- [ ] ISC-71: /leaderboard has "How to submit" section
- [ ] ISC-72: /docs page has links to GitHub README and MATHEMATICAL_FOUNDATIONS.md
- [ ] ISC-73: OG image at public/og-image.png or opengraph-image.tsx (1200x630)

### Phase 7 — Build + Lighthouse
- [ ] ISC-74: pnpm build succeeds with no errors
- [ ] ISC-75: out/index.html exists
- [ ] ISC-76: out/leaderboard/index.html exists
- [ ] ISC-77: out/docs/index.html exists
- [ ] ISC-78: out/_next/static/ exists with chunked JS
- [ ] ISC-79: Lighthouse Performance ≥ 90 (local serve)
- [ ] ISC-80: Lighthouse Accessibility ≥ 95 (local serve)
- [ ] ISC-81: Lighthouse Best Practices ≥ 90
- [ ] ISC-82: Lighthouse SEO ≥ 90
- [ ] ISC-83: Mobile layout verified (no horizontal scroll at 375px width)

### Phase 8 — Deploy
- [ ] ISC-84: existing public_html content backed up if present
- [ ] ISC-85: out/ rsync'd to ~/domains/alienclaw.net/public_html/
- [ ] ISC-86: alienclaw.net DNS resolves to Hostinger IP
- [ ] ISC-87: https://alienclaw.net returns HTTP 200
- [ ] ISC-88: SSL certificate valid (no curl SSL error)
- [ ] ISC-89: landing page renders on live site (screenshot)
- [ ] ISC-90: /leaderboard renders on live site
- [ ] ISC-91: /docs renders on live site

### Phase 9 — Commit + PR + Verdict
- [ ] ISC-92: all changes committed on packet-38-landing-site branch
- [ ] ISC-93: branch pushed to origin/packet-38-landing-site
- [ ] ISC-94: PR opened in bugsyhewitt/alienclaw-site targeting main
- [ ] ISC-95: .packet-reports/packet-38-verdict.md written with phase results

### Anti-criteria
- [ ] ISC-A-1: api.alienclaw.net directory not touched
- [ ] ISC-A-2: no V3X/Pho3nix/DigitalOcean references on site
- [ ] ISC-A-3: no third font installed (only Inter + Space Grotesk)
- [ ] ISC-A-4: no linear easing used (spring or ease-out minimum)
- [ ] ISC-A-5: no credentials or .env files committed
- [ ] ISC-A-6: PR not merged by AI

## Decisions

- 2026-05-29: Separate repo confirmed — different deploy target, cadence, identity
- 2026-05-29: Lime green #C8E731 — eyedroppered from logo (dominant green pixel)
- 2026-05-29: Static export only — Hostinger serves public_html statically
- 2026-05-29: API endpoint for leaderboard widget: /v1/genomes/top?martian_type=search_text_alone
- 2026-05-29: alienclaw.net currently returns 503 (broken Passenger config) — safe to replace .htaccess
- 2026-05-29: Custom public/.htaccess included in static export to enable DirectoryIndex + block .builds
- 2026-05-29: Framer Motion components use dynamic import (ssr:false) to protect Lighthouse Performance
- 2026-05-29: OG image as static PNG in public/ (not opengraph-image.tsx route) for simplicity with static export
