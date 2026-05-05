# Packet 7 Defaults Chosen

| Default | Value | Rationale |
| --- | --- | --- |
| Bridge max message size | 1 MiB | Genomes are 256 chars; inputs rarely exceed a few KB; no streaming needed |
| Timeout grace period (SIGTERM→SIGKILL) | 5 seconds | Enough for clean Python shutdown |
| stderr capture on crash | last 4 KiB | Enough for a full Python traceback |
| One subprocess per summon | yes | Simplest correct model; pooling deferred |
| Python entry point | `python3 -m alienclaw.bridge` | Discoverable, consistent, avoids full-path issues |
| ALIENCLAW_PYTHON_BIN | env var override | Operators who need a specific binary set it; default resolves via PATH |
| Fitness formula | `correctness × 1/max(1, tool_calls)` | Rewards efficiency; single tool call is perfect; capped at 1.0 |
| Fitness formula version | `"v1.0"` | Versioned from day one for future formula changes |
| Specialist ID tag | `"SPEC0001"` | Consistent 8-char tag; Packets 8-10 may differentiate by campaign type |
| Random genome seed | `Date.now()` | Non-deterministic by default; tests inject fixed seed |
| Compute runner safe names | math module + builtins | No arbitrary eval, no imports, no side effects |
| file_read max | 1 MiB | Same as bridge max; prevents memory exhaustion |
| http_get / url_fetch timeout | 30 seconds | Generous for slow networks; bridge timeout still enforces outer bound |
| web_search num_results default | 5 | Sufficient context without excessive data transfer |
