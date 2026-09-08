-- Migration 005: Ed25519 identity trust-on-first-use (TOFU) binding.
--
-- A leaderboard_name (8 uppercase letters) maps 1:1 to an Ed25519 public key
-- after the first signed submission. Subsequent submissions for that name must
-- present a valid signature from the same key.
--
-- Nonce replay prevention: each submission's nonce is stored in submission_nonces.
-- Application policy:
--   - Reject submissions with a timestamp more than ±5 minutes from server time.
--   - Reject submissions whose nonce already exists in submission_nonces.
--   - Nonces older than 10 minutes can be purged (by P3 cron or lazy cleanup).

-- ── Identity TOFU table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS identities (
  leaderboard_name  CHAR(8)      NOT NULL PRIMARY KEY,
  pubkey_b64        VARCHAR(64)  NOT NULL COMMENT 'Base64url Ed25519 public key (32 bytes → 44 chars)',
  registered_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_identity_name
    CHECK (leaderboard_name REGEXP '^[A-Z]{8}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Nonce replay-prevention table ────────────────────────────────────────
-- Each submission nonce is stored here on first use.
-- Primary key on nonce guarantees uniqueness at the DB level (belt+suspenders
-- alongside the application-level check).

CREATE TABLE IF NOT EXISTS submission_nonces (
  nonce    VARCHAR(64)  NOT NULL PRIMARY KEY,
  used_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_nonce_used_at (used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
