---
summary: "Uninstall AlienClaw completely (CLI, service, state, workspace)"
read_when:
  - You want to remove AlienClaw from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `alienclaw` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
alienclaw uninstall
```

Non-interactive (automation / npx):

```bash
alienclaw uninstall --all --yes --non-interactive
npx -y alienclaw uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
alienclaw gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
alienclaw gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${ALIENCLAW_STATE_DIR:-$HOME/.alienclaw}"
```

If you set `ALIENCLAW_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.alienclaw/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g alienclaw
pnpm remove -g alienclaw
bun remove -g alienclaw
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/AlienClaw.app
```

Notes:

- If you used profiles (`--profile` / `ALIENCLAW_PROFILE`), repeat step 3 for each state dir (defaults are `~/.alienclaw-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `alienclaw` is missing.

### macOS (launchd)

Default label is `ai.alienclaw.gateway` (or `ai.alienclaw.<profile>`; legacy `com.alienclaw.*` may still exist):

```bash
launchctl bootout gui/$UID/ai.alienclaw.gateway
rm -f ~/Library/LaunchAgents/ai.alienclaw.gateway.plist
```

If you used a profile, replace the label and plist name with `ai.alienclaw.<profile>`. Remove any legacy `com.alienclaw.*` plists if present.

### Linux (systemd user unit)

Default unit name is `alienclaw-gateway.service` (or `alienclaw-gateway-<profile>.service`):

```bash
systemctl --user disable --now alienclaw-gateway.service
rm -f ~/.config/systemd/user/alienclaw-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `AlienClaw Gateway` (or `AlienClaw Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "AlienClaw Gateway"
Remove-Item -Force "$env:USERPROFILE\.alienclaw\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.alienclaw-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://alienclaw.ai/install.sh` or `install.ps1`, the CLI was installed with `npm install -g alienclaw@latest`.
Remove it with `npm rm -g alienclaw` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `alienclaw ...` / `bun run alienclaw ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
