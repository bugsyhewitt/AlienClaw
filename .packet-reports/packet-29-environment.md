# Packet 29 — Audit Environment

## OS
Linux hostname 6.18.12+kali-amd64 #1 SMP PREEMPT_DYNAMIC Kali 6.18.12-1kali1 (2026-02-25) x86_64 GNU/Linux

## Node
v22.22.1

## Package managers
npm: 9.2.0
pnpm: 10.33.0
yarn: NOT PRESENT

## Python
Python 3.13.12
pip: pip 26.0.1 from /usr/lib/python3/dist-packages/pip (python 3.13)

## Git
git version 2.53.0

## AlienClaw-specific env vars currently set
### (a stranger would have NONE of these)
PWD=/home/xil/Desktop/alienclaw

## Anthropic env vars
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5
ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6
ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-7
ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5

## OpenClaw env vars
(no OPENCLAW vars)

## Note
A stranger may have different versions of all the above.
Audit conducted on: Sat May 16 09:00:08 PM UTC 2026

## Interpretability note

This audit was conducted on Kali Linux (Debian-based). A stranger might be on
Ubuntu, macOS, Windows/WSL, or any other platform. install.sh targets bash 3.2+
for macOS compatibility. The significant machine-specific items: openclaw is
pre-installed (v2026.4.22 vs current npm v2026.5.12), and ANTHROPIC env vars
are set — a stranger would have neither.

## Clean clone record

**Command:** `git clone https://github.com/AlienTool/AlienClaw.git /tmp/alienclaw-audit-20260516-170016`

**Result:** Success (exit code 0). Clone time: < 5 seconds.

**Repo size:** 64MB

**Top-level inventory (key files):**
```
AGENTS.md, ALIENCLAW_VERSION, assets/, CLAUDE.md, CONTRIBUTING.md
docs/, .env.example, .github/, git-hooks/, installer/
install.sh (11031 bytes)
LICENSE (1 byte — EMPTY — critical finding)
package.json, .packet-reports/, README.md (3640 bytes), ROADMAP.md
scripts/, SECURITY.md (20812 bytes), seed/, site/, src/, test/
tsconfig.json, VISION.md
```

Note: `.packet-reports/` appears in the clean clone — internal audit history
checked into the repo. A stranger cloning the repo will see this directory.

