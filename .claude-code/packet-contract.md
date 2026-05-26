# AlienClaw Packet Contract

This file is read by Claude Code before executing any packet in this repo. It encodes the disciplines that have already paid off three times catching bugs #12, #13, #14.

## Behavioral norms

- **Decide and move.** Surface to Bugsy only when: (a) credentials/accounts only he has, (b) architectural fork the packet doesn't cover, (c) security-sensitive call, (d) irreversible destructive op, (e) RED verdict.
- **Never bulk-commit to silence CI.** Per-file disposition with logged reason. Bug #13.
- **Working-tree-clean check at every phase start.** `git status` must show only files this phase intended. Dirty unexpectedly → STOP.
- **Assert the layer below.** A port's tests must assert the persistence backend, not just HTTP. Bug #14.
- **Clean-environment honesty.** "Works on my machine" is not "works." Bug #12.
- **No relitigating locked decisions.** See `.claude-code/locked-decisions.md`.

## Packet execution contract

Every packet run by `./run-packet.sh <packet-file>` MUST:

1. Start on a fresh branch `packet-<N>-<short-name>` cut from latest `origin/main`.
2. Verify working tree clean at every phase boundary.
3. Make commits with the format `packet-N: <imperative subject>` — scoped, attributed, never bulk.
4. Write `.packet-reports/packet-<N>-verdict.md` with one of: GREEN / YELLOW / RED, plus a one-paragraph summary.
5. Push the branch and open a PR to `main` via `gh pr create` with verdict pasted in the PR body.
6. Exit. Do NOT continue to other work.

## Escalation: when to STOP and surface

- A non-obvious architectural choice the packet doesn't pre-decide
- Any destructive op that wasn't in the packet (rm -rf, force-push, history rewrite, DB drop)
- Credentials needed that aren't in keychain/env
- A test failure whose root cause crosses the packet's scope
- ANY working-tree-dirty surprise

When surfacing: write `.packet-reports/packet-<N>-blocker.md` with the question, push the branch as-is, open the PR with verdict YELLOW or RED, and exit.

## Verdict definitions

- **GREEN** — all packet goals met, all gates passed, CI passes on the PR, no deferred items the packet was supposed to close.
- **YELLOW** — goals met but with deferred items or non-blocking surprises documented. Bugsy reviews before merge.
- **RED** — packet could not complete. Branch + PR opened so Bugsy can see partial state.

## File locations

- Packets live at `packets/packet-<N>-<short-name>.md`
- Reports live at `.packet-reports/` (gitignored — see Packet 32 plan)
- Verdicts: `.packet-reports/packet-<N>-verdict.md`
- Blockers (if any): `.packet-reports/packet-<N>-blocker.md`

## Bug log

See `.packet-reports/LESSONS_FROM_THE_ARC.md` for the running journal. Bugs #12/#13/#14 are the family this contract is built to prevent.
