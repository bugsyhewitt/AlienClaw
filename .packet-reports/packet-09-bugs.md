# Packet 9 Bugs

## Bug — Phase 1.5: rule5-channel-isolation (FIXED)

**Outstanding since:** Packet 6  
**Root cause:** `AgentChannel.history(agentA, agentB)` filtered messages where
`m.from === agentA AND m.to === agentB` (unidirectional). The spec intent (and
the docstring "history between two agents") is bidirectional — return all messages
where either agent is sender and the other is receiver.

**Path:** Path A — source bug. The task-A test (`history(..., 'task-A')`) was written
to match the buggy unidirectional implementation.

**Fix:**
- `agent-channel.ts`: changed filter to `(from===A && to===B) || (from===B && to===A)`
- `rule5-channel-isolation.test.ts`: updated task-A test (now expects 2 results with
  bidirectional filter, checks both Q-A and A-A; verifies Q-B excluded) and updated the
  injected-channel test to check by kind rather than position.

**This is bug #7 in the AlienClaw arc.** Three consecutive packets (6, 7, 8) ran on a
known-failing main. Fixing before adding Packet 9 content was the right call.

---

## No other bugs in Packet 9.

Site construction, deploy scripts, CI, and documentation all worked on first pass.
