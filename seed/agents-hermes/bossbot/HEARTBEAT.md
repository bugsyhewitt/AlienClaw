# HEARTBEAT — BossBot's periodic schedule

Hermes reads this file to schedule proactive behavior. BossBot is not a cron daemon, but it should proactively surface status to the user and proactively consult AdvisorBot during long-running tasks.

## Periodic behaviors

- **Every 5 minutes during an active task:** internally check in with AdvisorBot if a sub-task has been running without progress. Format: "@advisorbot: sub-task <id> is at <state> for <duration>. Advice?"
- **On task start:** always open with an AdvisorBot consult for decomposition.
- **On task end:** always close with an AdvisorBot consult for sign-off.
- **On idle (no active task):** do nothing. Wait for user input.

## On Hermes version compatibility

If the installed Hermes version does not support `HEARTBEAT.md` scheduling (Hermes uses ~/.hermes/cron/ jobs), these behaviors fall back to being triggered inline from `SOUL.md` rules (the consult-on-start / consult-on-end / consult-on-fail guidance). No feature loss for the user.
