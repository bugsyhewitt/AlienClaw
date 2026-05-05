---
spec: SUMMON_BRIDGE_SPEC
version: "1.0"
status: locked
last-updated: 2026-05-06
---

# Summon Bridge Specification

## Purpose and scope

The summon bridge is the cross-language interface between the TypeScript governance
layer (Packet 6) and the Python genome/brain/fitness layers (Packets 4-5-7). When
a Specialist summons a Martian, TypeScript spawns a Python subprocess, sends a JSON
request on stdin, reads a JSON response on stdout, and the subprocess exits.

This spec defines the wire protocol, subprocess model, error taxonomy, and
security model. Packet 5's `src/alienclaw/bridge/` implements the Python side.
Packet 7's `src/alienclaw/governance/real-summon-adapter.ts` implements the
TypeScript side. Both implement against this document.

---

## Versioning policy

The bridge is versioned from day one at `"bridge_version": "1.0"`. Every request
and response envelope carries the version string. A server that receives a
request with an unrecognized version MUST return a `MALFORMED_REQUEST` error rather
than attempt to parse the payload. Future breaking changes increment the version
(e.g., `"2.0"`); non-breaking additions may happen within `"1.0"` via optional
fields (older servers ignore unknown fields per the robustness principle).

---

## Process model

TypeScript spawns `python3 -m alienclaw.bridge` as a subprocess for each Martian
summon. The subprocess:

1. Reads **one** JSON request from stdin
2. Dispatches to the appropriate tool runner
3. Writes **one** JSON response to stdout
4. Exits with code 0 (success) or non-zero (internal server error)

**Stateless**: no persistent process, no connection reuse, no session state.
**One request per subprocess**: the process handles exactly one summon and exits.
Process pooling is explicitly deferred to a future version — not in v1.0.

---

## Wire format

- Each message is exactly **one line** of UTF-8 JSON terminated by `\n`
- Maximum message size: **1 MiB** (1,048,576 bytes, measured on the UTF-8 wire)
- Messages larger than 1 MiB MUST result in a `PAYLOAD_TOO_LARGE` error
- Servers SHOULD tolerate leading/trailing whitespace on the JSON line
- The response line is always written before the subprocess exits

---

## Request envelope

```json
{
  "bridge_version": "1.0",
  "request_id": "<UUID v4 string>",
  "request": {
    "kind": "summon",
    "genome": "<256-char Base62 string>",
    "martian_type": "<canonical tool name, e.g. http_get>",
    "inputs": { "<arbitrary structured inputs per martian_type>" },
    "timeout_ms": 60000
  }
}
```

Field constraints:

| Field | Type | Constraint |
| --- | --- | --- |
| `bridge_version` | string | MUST be `"1.0"` |
| `request_id` | string | MUST be a UUID v4 format |
| `request.kind` | string | MUST be `"summon"` |
| `request.genome` | string | MUST be exactly 256 Base62 characters |
| `request.martian_type` | string | MUST match a registered brain name |
| `request.inputs` | object | MAY be empty `{}` |
| `request.timeout_ms` | integer | MUST be in `[1, 600000]` |

---

## Response envelope — success

```json
{
  "bridge_version": "1.0",
  "request_id": "<echoed from request>",
  "response": {
    "ok": true,
    "output": { "<structured per martian_type>" },
    "fitness": 0.75,
    "run_metadata": {
      "tool_calls": 1,
      "wall_clock_ms": 42,
      "decoded_params": { "<genome parameter decode result>" },
      "correctness": 0.75,
      "efficiency": 1.0,
      "fitness_formula_version": "v1.0"
    }
  }
}
```

---

## Response envelope — error

```json
{
  "bridge_version": "1.0",
  "request_id": "<echoed, or null if request_id was unparseable>",
  "response": {
    "ok": false,
    "error": {
      "code": "<see error taxonomy below>",
      "message": "<human-readable description>",
      "details": { "<code-specific structured data>" }
    },
    "fitness": 0.0,
    "run_metadata": {
      "tool_calls": 0,
      "wall_clock_ms": 1
    }
  }
}
```

---

## Error taxonomy

| Code | Meaning | Common details fields |
| --- | --- | --- |
| `MALFORMED_REQUEST` | Request JSON fails to parse or violates schema | `parse_error`, `missing_fields` |
| `VERSION_MISMATCH` | `bridge_version` not recognized | `received`, `supported` |
| `INVALID_GENOME` | Genome fails validation per GENOME_SPEC.md | `errors` (list of strings) |
| `UNKNOWN_MARTIAN_TYPE` | `martian_type` not in brain registry | `available` (list of names) |
| `TOOL_RUNNER_FAILED` | Tool runner returned an error | `output_partial` (partial results if any) |
| `PAYLOAD_TOO_LARGE` | Request exceeds 1 MiB | `received_bytes` |
| `TIMEOUT` | TS-side timeout fired before response received | — |
| `INTERNAL` | Unexpected server-side error (programmer bug) | `exception`, `stderr_tail` |

---

## Timeout behavior

TypeScript-side timeout is enforced via `AbortController` before spawning the
subprocess. The sequence on timeout:

1. SIGTERM sent to subprocess
2. 5-second grace period
3. SIGKILL if process has not exited after grace period
4. `TIMEOUT` error returned to the caller with `timeout_ms` in details

The subprocess MUST also respect `request.timeout_ms` internally — tool runners
are expected to abort their own operations within the declared timeout.

---

## Subprocess crash behavior

If the Python subprocess exits with a non-zero code:

- TypeScript adapter returns an `INTERNAL` error
- `details.stderr_tail` contains the last 4 KiB of the subprocess's stderr
- `details.exit_code` contains the numeric exit code

---

## Security model

1. **Fixed command**: subprocess is always invoked as `python3 -m alienclaw.bridge`
   from the project root. The command is NEVER constructed from user input.
2. **Input via stdin only**: all request data flows through the JSON envelope on
   stdin. No request data is passed via subprocess arguments, environment variables,
   or command-line flags.
3. **No shell expansion**: spawn MUST use the non-shell form (array of arguments,
   `shell: false` in Node.js). No `sh -c`, no glob expansion.
4. **PATH-resolved Python**: `python3` is resolved via PATH. Operators who need a
   specific Python binary set `ALIENCLAW_PYTHON_BIN` env var; the adapter reads it.
5. **No arbitrary eval**: tool runners MUST NOT call `eval()`, `exec()`, or
   `subprocess.run(shell=True)`. Input data flows through typed parameters only.

---

## Validation rules (Python server side)

Every request MUST be validated before dispatch:

1. JSON parses without error
2. `bridge_version` is `"1.0"`
3. `request_id` is present (format SHOULD be UUID v4; validation is presence only)
4. `request.kind` is `"summon"`
5. `request.genome` passes `validate()` from GENOME_SPEC.md (length 256, Base62, checksum)
6. `request.martian_type` is present in the brain registry
7. `request.timeout_ms` is in `[1, 600000]`
8. Total request byte count ≤ 1 MiB

Validation failures return the appropriate error code before any tool runner is invoked.

---

## Idempotency

The bridge is NOT idempotent. The same `request_id` submitted twice produces two
independent tool runs. TypeScript-side generates fresh UUID v4 `request_id` values
per call, so duplicate submission is not expected in normal operation.

---

## Worked examples

### Example 1: Successful compute summon

Request:

```json
{"bridge_version":"1.0","request_id":"550e8400-e29b-41d4-a716-446655440000","request":{"kind":"summon","genome":"COMPUTE01G1AlienClaw1ComputeFamily00000000000000000000000000000001ASeq0000000000000000000000000000000000000000000000000000000000E0000000000000000000000000000000000000000000000000000000000000000XXXCHECKSUM64XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX","martian_type":"compute","inputs":{"task":"compute 7 + 35"},"timeout_ms":5000}}
```

Response:

```json
{"bridge_version":"1.0","request_id":"550e8400-e29b-41d4-a716-446655440000","response":{"ok":true,"output":{"result":42,"operation":"addition","resultType":"integer"},"fitness":1.0,"run_metadata":{"tool_calls":1,"wall_clock_ms":2,"decoded_params":{},"correctness":1.0,"efficiency":1.0,"fitness_formula_version":"v1.0"}}}
```

### Example 2: Invalid genome (wrong length)

Request:

```json
{"bridge_version":"1.0","request_id":"550e8400-e29b-41d4-a716-446655440001","request":{"kind":"summon","genome":"TOOSHORT","martian_type":"compute","inputs":{},"timeout_ms":5000}}
```

Response:

```json
{"bridge_version":"1.0","request_id":"550e8400-e29b-41d4-a716-446655440001","response":{"ok":false,"error":{"code":"INVALID_GENOME","message":"Length must be 256, got 8","details":{"errors":["Length must be 256, got 8"]}},"fitness":0.0,"run_metadata":{"tool_calls":0,"wall_clock_ms":0}}}
```

### Example 3: Unknown martian type

Request:

```json
{"bridge_version":"1.0","request_id":"550e8400-e29b-41d4-a716-446655440002","request":{"kind":"summon","genome":"<valid-256-char-genome>","martian_type":"nonexistent_brain","inputs":{},"timeout_ms":5000}}
```

Response:

```json
{"bridge_version":"1.0","request_id":"550e8400-e29b-41d4-a716-446655440002","response":{"ok":false,"error":{"code":"UNKNOWN_MARTIAN_TYPE","message":"No brain for martian_type='nonexistent_brain'","details":{"available":["compute","extract_json","file_read","file_write","http_get","search_text","url_fetch","web_search"]}},"fitness":0.0,"run_metadata":{"tool_calls":0,"wall_clock_ms":0}}}
```

### Example 4: Malformed request (bad JSON)

Input: `not_valid_json\n`

Response:

```json
{"bridge_version":"1.0","request_id":null,"response":{"ok":false,"error":{"code":"MALFORMED_REQUEST","message":"JSON parse error: Expecting value: line 1 column 1 (char 0)","details":{"parse_error":"Expecting value: line 1 column 1 (char 0)"}},"fitness":0.0,"run_metadata":{"tool_calls":0,"wall_clock_ms":0}}}
```

### Example 5: Payload too large

If the request JSON exceeds 1 MiB, the server SHOULD detect this before full parsing
and return:

```json
{"bridge_version":"1.0","request_id":null,"response":{"ok":false,"error":{"code":"PAYLOAD_TOO_LARGE","message":"Request exceeds 1 MiB limit","details":{"received_bytes":1100000}},"fitness":0.0,"run_metadata":{"tool_calls":0,"wall_clock_ms":0}}}
```

---

## Defaults chosen during specification

- **Max message size**: 1 MiB — balances practical input sizes (genomes are 256 chars;
  inputs rarely exceed a few KB) against simplicity (streaming would be complex)
- **Timeout grace period**: 5 seconds after SIGTERM before SIGKILL
- **stderr capture**: last 4 KiB captured on crash — enough for a traceback
- **One subprocess per summon**: simplest correct model; pooling deferred to measured need
- **Python entry point**: `python3 -m alienclaw.bridge` — discoverable, consistent, avoids full-path issues
- **ALIENCLAW_PYTHON_BIN override**: allows operators to pin a specific Python binary
- **`request_id` format**: UUID v4 strongly encouraged but presence-only validated at the server — resilient to future ID format changes

---

## What is NOT in this spec

- **Process pooling / connection reuse**: deferred; measure first
- **Streaming responses**: the bridge is request/response, not streaming
- **Bidirectional comms**: subprocess is read-once/write-once; no push from Python to TS
- **Request multiplexing**: one request per subprocess; multiple concurrent summons use multiple subprocesses
- **Authentication between TS and Python**: not needed for same-machine IPC
- **Binary protocol / protobuf**: JSON-over-stdio is sufficient for v1.0 throughput
