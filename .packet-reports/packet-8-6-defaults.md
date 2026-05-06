# Packet 8.6 Defaults Chosen

| Default | Value | Rationale |
| --- | --- | --- |
| MSB file edit approach | A1 (structured PARAMETER_SCHEMA section) | Honest schema declarations vs fragile prose parsing. One-time cost. |
| parameter_schema format | Pipe-separated: name\|section\|byte_offset\|encoding\|type\|default | Simple to parse; matches MSB's existing plain-text style |
| Params per runner | 3 (max_attempts + fail_forward + 1 runner-specific) | Minimal for working signal; extensible to BEHAVIOR bytes 2-63 |
| Runner-specific param slot | BEHAVIOR byte 1 | Byte 0 is fail_forward; bytes 1-63 are "zero padding" = available |
| Encoding for bool params | char_code_even (ord % 2 == 0) | ~50% of Base62 chars are even → good variation probability |
| Encoding for int params 1-5 | mod5_plus1 ((ord-48) % 5 + 1) | Mirrors existing MSB prose "charCode-48 mod 5 + 1 = maxAttempts" |
| Encoding for int params 1-10 | mod10_plus1 ((ord-48) % 10 + 1) | 10 distinct values; good sensitivity with mutation rate 0.5 |
| Registry loading | Lazy singleton in bridge/server.py | First summon loads once; subsequent summons reuse. Works for subprocess model. |
| Backward compat for missing schema | parameter_schema = () | Brains without PARAMETER_SCHEMA section parse fine; decoder returns {} |
| Phase D scope | Deferred (design doc written) | Success criteria met without graded correctness; ship signal first |

## Override paths

- Add more params: add lines to PARAMETER_SCHEMA in the relevant .msb file, add handling to the runner
- Change encoding: add a new encoding name to `_apply_encoding()` in decoder.py
- Graded correctness: implement per-runner design in packet-8-6-runner-design.md (Packet 8.7)
