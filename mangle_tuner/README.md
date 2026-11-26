# mangle_tuner — AlienClaw × mangle GA PoC

**Phase 1 of the AlienClaw repurpose roadmap.** Replaces AlienClaw's self-referential
fitness with real external fitness from the mangle H.265 fuzzer.

## What it does

Runs AlienClaw's genetic algorithm on mangle campaign configs, evolving toward configs
that maximize crash rate on a fixed H.265 seed. The winning config is emitted as a
checksummed 256-char AlienClaw genome — a portable, shareable "campaign genome."

## Setup

Both projects must be on sys.path (the scripts handle this automatically):
- AlienClaw: `~/dev/alienclaw/src`
- mangle: `~/dev/necromancer/projects/mangle/src`

Dependencies: `ffmpeg` or `libde265` must be installed (mangle's decoder backends).

## Running

```bash
# From ~/dev/alienclaw/
python mangle_tuner/run_ga.py \
    --seed-file ~/dev/necromancer/projects/mangle/tests/fixtures/clean.h265 \
    --held-out-seed ~/dev/necromancer/projects/mangle/tests/fixtures/sei-buffering.hevc \
    --pop-size 16 \
    --generations 10 \
    --eval-iterations 100
```

The two fixture seeds serve as training/held-out split. Use your own H.265 corpus for
real campaigns.

## Genome schema

Gene params are stored in the EXECUTION slot (slot_index=1), Xcodes 0–5:

| Xcode | Param            | Range           | Mapping         |
|-------|-----------------|-----------------|-----------------|
| 0     | strategy        | [0,1]           | 0=uniform, 1=adaptive |
| 1     | alpha×10        | [1,50]          | alpha = val/10.0 |
| 2     | beta×10         | [1,50]          | beta = val/10.0 |
| 3     | ef×1000         | [0,45]          | ef = val/1000.0 |
| 4     | concurrency     | [1,16]          | int |
| 5     | timeout×10      | [10,300]        | timeout = val/10.0 s |

## Gate (success bar)

The evolved genome must beat **both** the uniform-default baseline AND the
adaptive-default baseline on the held-out seed. This guards against overfitting to
the training seed.

## Phase 1b (future)

- Extend mangle's `make_scheduler` API to accept alpha/beta/ef natively (removes
  the monkey-patch from fitness_adapter.py)
- Add mutator subset selection as additional gene params (Xcodes 6–27)
- Use `--seed-corpus-dir` for multi-seed campaigns (broader training signal)
