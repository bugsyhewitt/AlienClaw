# Deployment scripts

## deploy.sh

Deploys `site/` to alienclaw.net via SSH + rsync. Idempotent. Atomic
(rsync `--delete-after` completes the upload before removing stale files).

### Required environment variables

| Variable | Description |
| --- | --- |
| `ALIENCLAW_DEPLOY_HOST` | SSH hostname (Hostinger server) |
| `ALIENCLAW_DEPLOY_USER` | SSH username |
| `ALIENCLAW_DEPLOY_PATH` | Remote site root (e.g. `~/domains/alienclaw.net/public_html`) |

### Optional environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `ALIENCLAW_DEPLOY_PORT` | `22` | SSH port |
| `ALIENCLAW_DEPLOY_SSH_KEY` | (ssh-agent) | Path to private key |

### Examples

```bash
# Dry run — shows what would change, nothing uploaded
./scripts/deploy.sh --dry-run

# Deploy to _staging subdirectory (no production swap)
./scripts/deploy.sh --staging

# Production deploy
./scripts/deploy.sh
```

### Setup checklist

1. Add your SSH public key to Hostinger via their control panel.
2. Verify the connection works:
   ```bash
   ssh -p $ALIENCLAW_DEPLOY_PORT $ALIENCLAW_DEPLOY_USER@$ALIENCLAW_DEPLOY_HOST 'pwd'
   ```
3. Put env vars in a local `.envrc` (gitignored — NOT committed):
   ```bash
   export ALIENCLAW_DEPLOY_HOST=...
   export ALIENCLAW_DEPLOY_USER=...
   export ALIENCLAW_DEPLOY_PATH=...
   ```
4. Run `./scripts/deploy.sh --dry-run` first.
5. Run `./scripts/deploy.sh --staging`, review at the staging URL.
6. Run `./scripts/deploy.sh` for production.

### Security

Credentials are NEVER committed. The deploy script reads them from env.
SSH key auth is preferred over password auth.
The script uses `StrictHostKeyChecking=accept-new` on first connect;
on subsequent connects the host key is verified from `~/.ssh/known_hosts`.

---

## local-preview.sh

Serves `site/` on http://localhost:8000 for visual review before deploying.
Optionally accepts a port argument: `./scripts/local-preview.sh 9000`.

```bash
./scripts/local-preview.sh
# → open http://localhost:8000 in your browser
# → Ctrl-C to stop
```
