# Google Gemini CLI Auth (AlienClaw plugin)

OAuth provider plugin for **Gemini CLI** (Google Code Assist).

## Account safety caution

- This plugin is an unofficial integration and is not endorsed by Google.
- Some users have reported account restrictions or suspensions after using third-party Gemini CLI and Antigravity OAuth clients.
- Use caution, review the applicable Google terms, and avoid using a mission-critical account.

## Enable

Bundled plugins are disabled by default. Enable this one:

```bash
alienclaw plugins enable google-gemini-cli-auth
```

Restart the Gateway after enabling.

## Authenticate

```bash
alienclaw models auth login --provider google-gemini-cli --set-default
```

## Requirements

Requires the Gemini CLI to be installed (credentials are extracted automatically):

```bash
brew install gemini-cli
# or: npm install -g @google/gemini-cli
```

## Env vars (optional)

Override auto-detected credentials with:

- `ALIENCLAW_GEMINI_OAUTH_CLIENT_ID` / `GEMINI_CLI_OAUTH_CLIENT_ID`
- `ALIENCLAW_GEMINI_OAUTH_CLIENT_SECRET` / `GEMINI_CLI_OAUTH_CLIENT_SECRET`
