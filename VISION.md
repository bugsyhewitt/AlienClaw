# Vision

AlienClaw exists to test one bet: that agents using fewer tool calls produce real
environmental savings, and that genome-based evolution plus a community-shared
leaderboard is the mechanism that makes those savings propagate.

## The thesis

Most agent frameworks sprawl. They make 50 tool calls when they could make 5.
Each unnecessary call costs compute — which costs data center water (cooling) and
energy. At scale, that is a real environmental cost, invisible to the operator.

AlienClaw selects against sprawl. The fitness function rewards correct output
divided by tool calls. Genomes that produce equivalent results with fewer tool
calls win selection rounds. Over generations, the population gets dramatically
more efficient.

The community genome network propagates winning genomes globally. One efficient
genome, evolved on one operator's instance, propagates to every other instance
running the same Martian type. The mass-ML effect: millions of operators each
contribute fitness data; everyone benefits from the efficiencies anyone discovers.

## Why three layers, not one

A single agent that has to do everything has a complex genome with many constraints.
Mutation navigates a high-dimensional search space. Evolution gets stuck.

Splitting work across three layers keeps each layer's search space narrow:

- **Governance** (BossBot, AdvisorBot, CreatorBot) is fixed code, not evolved.
  The complexity is in planning, not execution. LLM flexibility is the right
  tool here.
- **Specialists** are ephemeral and custom-built per campaign. They hold
  campaign-specific knowledge that would bloat a persistent agent. They erase
  when the campaign ends — no accumulated cruft.
- **Martians** are narrow tool-callers. Their genome only encodes decisions about
  how to use a small number of tools well. The search space is small enough that
  evolution converges fast.

## Why open source

The bet only works at scale. One operator's evolved genomes cannot prove much;
thousands of operators contributing fitness data each can. Open source plus a
public leaderboard plus a community genome network is how that scale gets reached.

The work matters even if AlienClaw never reaches acquisition. Best case is
big-tech recognition of the genome evolution mechanism. Acceptable outcomes
include open-source recognition as a respected research project or merge into a
larger ecosystem. The genome evolution mechanism is the contribution.

## What is not the vision

- A general-purpose agent runtime (use OpenClaw for that — AlienClaw is a layer
  on top, not a replacement)
- A replacement for human review (governance includes a Specialist-to-BossBot
  report so the user always sees a summary)
- A profit-extracting commercial product (free on GitHub, donations optional,
  no paid tiers planned)
- A walled-garden ecosystem (community genome network is open API, open source,
  open documentation)

## Future directions (explicitly labeled as future)

The current scope — 256-char Base62 Martian genomes, ephemeral non-evolved
Specialists — is what is being built now. After the initial loop is proven:

- **Specialist evolution**: longer genomes (512+ char) for the broader
  campaign-scale search space. End-game, not near-term.
- **Leaderboard depth**: domain-specific rankings, human-curated sets,
  operator-trust weights.
- **Governance extension**: finer-grained roles if fitness data shows clear gains.

These are explicitly not in current scope. They are documented so contributors
can see where the project might go — not so anyone builds toward them today.
