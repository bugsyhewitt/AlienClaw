# TOOLS — CreatorBot

CreatorBot has access to the standard OpenClaw file write tool only.

## Available tool

- **Write specialist spec** — writes a markdown spec file to `~/.hermes/agents/creatorbot/specialists/`.
  - Input: specialist name, task class, tool set description.
  - Output: file path of the created spec.
- No other tools are wired in v0.1.

## Usage

When BossBot sends a build request, use the file write tool to create `~/.hermes/agents/creatorbot/specialists/specialist-<timestamp>.md`, then respond with the file path.