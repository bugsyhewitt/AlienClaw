---
spec: LEADERBOARD_API_SPEC
version: "1.0"
status: locked
last-updated: 2026-05-05
---

# Leaderboard API Specification

## Purpose and scope

`api.alienclaw.net/v1/` is the REST API for the AlienClaw community genome network.
It has two surfaces: genome submission (CreatorBot pushes evolved genomes when they
beat the community top) and genome retrieval (CreatorBot pulls top-N per Martian type
to augment the local population). Together they implement the mass-ML mechanism that
makes efficiency gains propagate globally.

This spec defines the versioned API contract, authentication scheme, all six endpoints,
request/response schemas, validation rules, rate limiting, and the CreatorBot client
sync protocol. Packet 10 implements the server. CreatorBot's sync logic (also Packet 10)
implements the client side.

---

## Versioning policy

The API is versioned from day one at `/v1/`. Every endpoint in this spec is
under `/v1/`. Future breaking changes go to `/v2/` — never modify a published
`/v1/` endpoint in a breaking way. Non-breaking additions (new optional response
fields, new endpoints within `/v1/`) are allowed without a version bump.

**Breaking change examples** (require `/v2/`):

- Removing a field from a response
- Changing a field's type
- Changing an endpoint's URL or method
- Adding a required request field

**Non-breaking examples** (allowed in `/v1/`):

- Adding an optional response field
- Adding a new endpoint
- Adding an optional request query parameter

Once Packet 10 ships `/v1/` publicly, this contract is immutable. Treat it as a
public API from day one even during development — the community genome network's
value depends on client stability.

---

## Base URL

```
https://api.alienclaw.net/v1/
```

All paths below are relative to this base URL. HTTP (non-TLS) is NOT supported.
All requests MUST use HTTPS. Clients that connect via HTTP MUST receive a
`301 Moved Permanently` redirect to the HTTPS equivalent, NOT an error response.

---

## Authentication

Most write endpoints require authentication. Some read endpoints are unauthenticated
to minimize friction for community participation.

### API key generation

At first run, each AlienClaw install generates a per-install API key:

```pseudocode
key_bytes = crypto_random_bytes(32)
api_key   = base62_encode(key_bytes)  # produces a 43-char Base62 string
```

The key is stored at `~/.alienclaw/api-key.txt` with file mode `0600`. The install
then calls `POST /v1/install` to register the key. If the key file already exists,
skip generation and use the existing key.

**Key format**: 43 characters, Base62 alphabet (same as genome encoding). The 43
chars come from ceil(256 / log2(62)) ≈ 43 chars to represent 32 bytes of entropy.

### Request authentication

Authenticated requests MUST include:

```
Authorization: Bearer <api_key>
```

Requests to authenticated endpoints without this header MUST receive `401 Unauthorized`.
Requests with a malformed header (not `Bearer <43-char-Base62>`) MUST receive
`400 Bad Request`.

### Which endpoints require auth

| Endpoint | Auth required |
| --- | --- |
| `POST /v1/install` | No (bootstraps the key) |
| `POST /v1/genomes` | Yes |
| `GET /v1/genomes/top` | No (read-only, public) |
| `GET /v1/martian-types` | No |
| `GET /v1/health` | No |
| `GET /v1/stats` | No |

---

## Endpoints

### POST /v1/install

Register an install. Called once per install at first run (or when the key file is
missing and must be regenerated).

**Request body** (JSON):

```json
{
  "api_key": "string (43-char Base62)",
  "machine_hash": "string (64-char hex SHA-256 of stable machine identifier)"
}
```

`machine_hash` is a SHA-256 of a stable machine identifier (e.g., machine ID from
`/etc/machine-id` on Linux, or a UUID generated once and stored locally). It is
NOT the raw machine ID — it is a one-way hash. No PII is sent. The hash is used
only for rate-limit bucketing and abuse detection (detecting one machine registering
thousands of keys).

**Response: 201 Created** (new install):

```json
{
  "status": "registered",
  "install_id": "string (opaque server-assigned install identifier)",
  "rate_limit": {
    "submissions_per_hour": 100,
    "window_seconds": 3600
  }
}
```

**Response: 200 OK** (already registered):

```json
{
  "status": "known",
  "install_id": "string",
  "rate_limit": {
    "submissions_per_hour": 100,
    "window_seconds": 3600
  }
}
```

**Validation errors** → `400 Bad Request`:

- `api_key` not exactly 43 Base62 chars
- `machine_hash` not exactly 64 hex chars
- Missing required fields

---

### POST /v1/genomes

Submit a genome and its measured fitness score. Called by CreatorBot when a locally
evolved genome beats the current community top for its Martian type.

**Request body** (JSON):

```json
{
  "genome": "string (256-char Base62)",
  "martian_type": "string (canonical Martian type name, e.g. 'web_search')",
  "fitness": "number (float, 0.0 to 1.0 inclusive)",
  "run_metadata": {
    "campaign_count": "integer (how many campaigns this genome participated in)",
    "total_task_count": "integer (total tool-call tasks attempted)",
    "generation": "integer (genome generation number)",
    "local_top_fitness": "number (this install's current top fitness for this type)",
    "alienclaw_version": "string (semver)"
  }
}
```

`run_metadata` is informational — used for research and leaderboard enrichment. All
fields in `run_metadata` are optional but SHOULD be included when available.
`run_metadata` MUST NOT exceed 4096 bytes when serialized as JSON.

**Response: 201 Created**:

```json
{
  "submission_id": "string (opaque server-assigned ID)",
  "submitted_at": "string (ISO 8601 timestamp)",
  "rank": "integer (this genome's rank among all submissions for this martian_type)",
  "is_new_top": "boolean (whether this genome is now the global top for this type)"
}
```

**Validation errors** → `422 Unprocessable Entity`:

- `genome` length ≠ 256
- `genome` contains non-Base62 characters
- `genome` checksum invalid (server recomputes and verifies per GENOME_SPEC.md)
- `fitness` < 0.0 or > 1.0 or not a number
- `martian_type` not in the registered type list
- `run_metadata` exceeds 4096 bytes serialized

**Duplicate suppression**: The server SHOULD detect and silently deduplicate identical
genome+martian_type+fitness submissions from the same install within a 24-hour window.
The response to a duplicate MUST be `200 OK` (not 201) with the original submission's
data.

---

### GET /v1/genomes/top

Fetch the top-N genomes for a given Martian type. Called by CreatorBot during sync
to augment the local population.

**Query parameters**:

| Parameter | Type | Default | Max | Required |
| --- | --- | --- | --- | --- |
| `martian_type` | string | — | — | Yes |
| `n` | integer | 10 | 100 | No |

**Response: 200 OK**:

```json
{
  "martian_type": "string",
  "genomes": [
    {
      "genome": "string (256-char Base62)",
      "fitness": "number",
      "submission_id": "string",
      "submitted_at": "string (ISO 8601)",
      "generation": "integer (from run_metadata, if provided)"
    }
  ],
  "total_for_type": "integer (total submissions for this martian_type)"
}
```

Results are sorted by `fitness` descending. If `n` exceeds the total available
for the type, the server returns all available (no error).

**Validation errors** → `400 Bad Request`:

- Missing `martian_type`
- `martian_type` not in registered list
- `n` > 100 or `n` < 1

Clients MUST validate each returned genome before using it (Base62, length 256,
checksum valid per GENOME_SPEC.md). Server-side validation does not absolve the
client of trust-but-verify.

---

### GET /v1/martian-types

List all registered Martian types the leaderboard knows about.

**Response: 200 OK**:

```json
{
  "martian_types": [
    {
      "name": "string (e.g. 'web_search')",
      "current_top_fitness": "number",
      "submission_count": "integer",
      "last_submission_at": "string (ISO 8601)"
    }
  ],
  "total": "integer"
}
```

No query parameters. No auth. No pagination at v1 (type count is small).

---

### GET /v1/health

Server health check.

**Response: 200 OK**:

```json
{
  "status": "ok",
  "version": "string (server semver)",
  "uptime_seconds": "integer"
}
```

**Response: 503 Service Unavailable** (if server is degraded):

```json
{
  "status": "degraded",
  "message": "string (human-readable reason)"
}
```

No auth. Used by monitoring and by clients to check connectivity before sync.

---

### GET /v1/stats

Aggregated statistics. Intentionally low-resolution — no per-install information
is exposed. No auth.

**Response: 200 OK**:

```json
{
  "total_genomes": "integer",
  "total_installs": "integer",
  "total_fitness_evaluations": "integer",
  "top_fitness_by_type": {
    "<martian_type>": "number"
  }
}
```

---

## Validation rules

The server MUST reject any `POST /v1/genomes` submission where:

1. `len(genome) != 256`
2. Any character in `genome` is not in the Base62 alphabet
3. `computeChecksum(genome[0:192]) != genome[192:256]` (per GENOME_SPEC.md)
4. `fitness < 0.0` or `fitness > 1.0`
5. `martian_type` is not in the registered type list
6. `run_metadata` serializes to more than 4096 bytes

The server SHOULD detect and rate-limit gaming patterns:

- Same install submitting more than 10 identical genomes in 1 hour
- Claimed fitness exceeding a statistical threshold relative to the type's fitness
  distribution (e.g., 3 standard deviations above the mean for genomes with fewer
  than 5 run_metadata campaign_count submissions — suspicious high fitness with low
  evidence)

Gaming detection SHOULD log and flag, not reject silently. Rejected gaming attempts
MUST return `429 Too Many Requests` with a human-readable `error.message`.

---

## Rate limiting

All authenticated endpoints share a per-install rate limit bucket:

- **Default**: 100 submissions per hour per install
- **Window**: rolling 3600-second window
- **Applies to**: `POST /v1/genomes` only (install is a one-time call)

When the rate limit is exceeded:

**Response: 429 Too Many Requests**:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Submission rate limit reached. Retry after the window resets.",
    "details": {
      "limit": 100,
      "window_seconds": 3600,
      "retry_after_seconds": 1247
    }
  }
}
```

The response MUST include a `Retry-After` header with the number of seconds until
the rate limit window resets.

---

## Error response format

All errors across all endpoints use this uniform structure:

```json
{
  "error": {
    "code": "string (ALL_CAPS_SNAKE_CASE error code)",
    "message": "string (human-readable description)",
    "details": { "...": "optional structured data" }
  }
}
```

Known error codes:

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `INVALID_API_KEY_FORMAT` | 400 | API key not 43 Base62 chars |
| `UNAUTHORIZED` | 401 | Missing or invalid Bearer token |
| `INVALID_GENOME_LENGTH` | 422 | Genome not exactly 256 chars |
| `INVALID_GENOME_ALPHABET` | 422 | Non-Base62 chars in genome |
| `INVALID_GENOME_CHECKSUM` | 422 | Checksum mismatch |
| `INVALID_FITNESS_RANGE` | 422 | Fitness not in [0.0, 1.0] |
| `UNKNOWN_MARTIAN_TYPE` | 422 | martian_type not registered |
| `METADATA_TOO_LARGE` | 422 | run_metadata exceeds 4096 bytes |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit hit |
| `INTERNAL_ERROR` | 500 | Server-side error |

---

## CORS policy

- `GET` endpoints (`/v1/genomes/top`, `/v1/martian-types`, `/v1/health`, `/v1/stats`):
  `Access-Control-Allow-Origin: *` — safe to expose publicly for browser-based
  leaderboard displays.
- `POST` endpoints (`/v1/install`, `/v1/genomes`): NO CORS headers. Write operations
  MUST NOT be callable from browsers. These are CreatorBot process calls only.

---

## CreatorBot sync protocol (client side)

Every 84 hours (default; configurable in client settings), CreatorBot:

### Push phase

1. For each Martian type the install has evolved genomes for:
   a. Determine the local top genome by fitness
   b. Call `GET /v1/genomes/top?martian_type=<name>&n=1` to get the global top
   c. If `local_top.fitness > global_top.fitness`: call `POST /v1/genomes` to submit
   d. Log the result (submitted / not beaten global top)

### Pull phase

2. For each Martian type in `GET /v1/martian-types`:
   a. Call `GET /v1/genomes/top?martian_type=<name>&n=10`
   b. Validate each returned genome (Base62 alphabet, length 256, checksum — per
      GENOME_SPEC.md; do NOT trust the server blindly)
   c. Compare fetched genomes against local population
   d. If fetched genomes include fitness values above the local median:
      replace the bottom 50% of the local population for this type with the fetched
      top genomes (default replacement policy — see packet-03-defaults.md)
   e. Log: how many genomes were added, the delta in local population top fitness

### Health check before sync

3. Before any push/pull, call `GET /v1/health`. If the response is not `200 OK`
   with `status: "ok"`, skip the entire sync cycle and log the skip reason.
   Retry at the next scheduled interval (84 hours later).

### Sync state

CreatorBot stores sync state at `~/.alienclaw/sync-state.json`:

```json
{
  "last_sync_at": "ISO 8601 timestamp",
  "next_sync_at": "ISO 8601 timestamp",
  "last_sync_result": {
    "submitted": "integer",
    "fetched": "integer",
    "errors": ["string"]
  }
}
```

---

## Data retention

All genome submissions are stored permanently (v1 policy). No PII is stored:

- `api_key` is stored as an opaque identifier (not revealed in any API response)
- `machine_hash` is stored but not exposed in any API response
- Genome strings, fitness scores, Martian types, timestamps, and run_metadata fields
  are stored and may appear in aggregate stats or top-genome responses

Retention policy for v1: forever. Research value of the fitness evolution data
justifies permanent retention. May add tiered retention (archive → delete) in v2
if storage becomes a concern.

---

## Future-flag: public audit log

The server MAY (not MUST) publish a daily snapshot of all submissions (genome,
fitness, martian_type, submitted_at, submission_id) to a public read-only endpoint
or git-exported dataset. This allows full audit transparency of the genome population.

If implemented, the snapshot endpoint WOULD be:

```
GET /v1/audit/daily/<YYYY-MM-DD>
```

Returning newline-delimited JSON (NDJSON) of submission records for that date.
Not required for v1 launch. Including this flag so it can be added without breaking
the contract.

---

## Worked examples

### Example 1: POST /v1/install

Request:

```http
POST /v1/install HTTP/1.1
Host: api.alienclaw.net
Content-Type: application/json

{
  "api_key": "7Kp3mNxQrB9sLvYwAcFdGhJzTnUeWi4oRkXbCqEmPsH2",
  "machine_hash": "a3f8b2e9c1d4f7a0b5e8c3d6f1a4b7e0c5d8f3a6b9e2c5d8f1a4b7e0c3d6f9a"
}
```

Response (new install):

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "status": "registered",
  "install_id": "inst_7kMnPq",
  "rate_limit": {
    "submissions_per_hour": 100,
    "window_seconds": 3600
  }
}
```

### Example 2: POST /v1/genomes

Request:

```http
POST /v1/genomes HTTP/1.1
Host: api.alienclaw.net
Authorization: Bearer 7Kp3mNxQrB9sLvYwAcFdGhJzTnUeWi4oRkXbCqEmPsH2
Content-Type: application/json

{
  "genome": "WEB00001G1AlienClaw1WebSearchFamily000000000000000000000000000000003RSequentialPerfBalanced000000000000000000000000000000000000000000EscalateStdOutputJSONArray0000000000000000000000000000000000000000<64-char-checksum>",
  "martian_type": "web_search",
  "fitness": 0.847,
  "run_metadata": {
    "campaign_count": 12,
    "total_task_count": 348,
    "generation": 7,
    "local_top_fitness": 0.847,
    "alienclaw_version": "2026.4.10"
  }
}
```

Response:

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "submission_id": "sub_3nKpMq",
  "submitted_at": "2026-05-05T20:45:00Z",
  "rank": 3,
  "is_new_top": false
}
```

### Example 3: GET /v1/genomes/top

Request:

```http
GET /v1/genomes/top?martian_type=web_search&n=3 HTTP/1.1
Host: api.alienclaw.net
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "martian_type": "web_search",
  "genomes": [
    {
      "genome": "<256-char Base62 genome string>",
      "fitness": 0.923,
      "submission_id": "sub_1aBcDe",
      "submitted_at": "2026-05-04T14:22:00Z",
      "generation": 14
    },
    {
      "genome": "<256-char Base62 genome string>",
      "fitness": 0.891,
      "submission_id": "sub_2fGhIj",
      "submitted_at": "2026-05-03T09:15:00Z",
      "generation": 11
    },
    {
      "genome": "<256-char Base62 genome string>",
      "fitness": 0.847,
      "submission_id": "sub_3nKpMq",
      "submitted_at": "2026-05-05T20:45:00Z",
      "generation": 7
    }
  ],
  "total_for_type": 1247
}
```

### Example 4: GET /v1/stats

Request:

```http
GET /v1/stats HTTP/1.1
Host: api.alienclaw.net
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "total_genomes": 8431,
  "total_installs": 247,
  "total_fitness_evaluations": 184920,
  "top_fitness_by_type": {
    "web_search": 0.923,
    "file_read": 0.891,
    "url_fetch": 0.856
  }
}
```

### Example 5: 422 validation error

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "error": {
    "code": "INVALID_GENOME_LENGTH",
    "message": "Genome must be exactly 256 characters; got 254.",
    "details": {
      "received_length": 254,
      "required_length": 256
    }
  }
}
```

---

## Defaults chosen during specification

See `packet-03-defaults.md` for the consolidated list.

Key defaults in this spec:

- **API key length**: 43 Base62 chars (32 bytes entropy)
- **Rate limit**: 100 submissions per install per hour
- **Sync interval**: 84 hours (3.5 days)
- **Top-N default**: 10 (max 100)
- **Population replacement policy**: replace bottom 50% with fetched top genomes
- **run_metadata size limit**: 4096 bytes
- **Data retention**: forever (v1)

---

## What is NOT in this spec

- **Leaderboard UI**: the public alienclaw.net page showing top genomes per type;
  that is Packet 9 (frontend) plus future UI work
- **Genome lineage tracking**: parent submission IDs; could be added as optional
  field in v1.x without breaking clients
- **Federated leaderboards**: multiple alternate servers; requires discovery
  mechanism and per-server trust weighting; future spec
- **Payment / donate integration**: out of scope; may live on alienclaw.net only
- **Admin API**: for server operators to manage installs, adjust rate limits, etc.;
  out of v1 scope
- **Webhook notifications**: push notifications when a new global top is set;
  future feature
