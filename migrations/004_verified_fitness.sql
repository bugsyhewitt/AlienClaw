-- Migration 004: Verified fitness split and genome identity for idempotent writes.
-- ADDITIVE ONLY — no column renames or drops.
-- The existing `fitness` column remains and represents client-reported fitness.
--
-- Requires: MySQL 8.0.3+ (ADD COLUMN IF NOT EXISTS, ADD UNIQUE KEY IF NOT EXISTS,
--           CREATE INDEX IF NOT EXISTS were introduced in MySQL 8.0.3).
-- If your Hostinger plan runs MySQL 5.7, apply this migration manually and guard
-- each ALTER with a conditional procedure, or upgrade to MySQL 8.

-- ── Verified fitness columns ──────────────────────────────────────────────
-- These are NULL until the P6 server-side verifier sets them.

ALTER TABLE leaderboard_entries
  ADD COLUMN IF NOT EXISTS verified_fitness  DOUBLE       NULL,
  ADD COLUMN IF NOT EXISTS verified_at       DATETIME     NULL,
  ADD COLUMN IF NOT EXISTS suite_version     VARCHAR(32)  NULL,
  ADD COLUMN IF NOT EXISTS evaluator_version VARCHAR(32)  NULL,
  ADD COLUMN IF NOT EXISTS fitness_version   VARCHAR(16)  NULL,
  ADD COLUMN IF NOT EXISTS msb_version       VARCHAR(16)  NULL,
  ADD COLUMN IF NOT EXISTS genome_version    VARCHAR(16)  NULL;

-- ── Genome identity column ────────────────────────────────────────────────
-- genome_id = SHA2(genome, 256). Used as the deduplication key so that
-- re-submissions of the same genome do not create duplicate rows.

ALTER TABLE leaderboard_entries
  ADD COLUMN IF NOT EXISTS genome_id VARCHAR(64) NULL;

-- Backfill genome_id for any existing rows before enforcing NOT NULL.
UPDATE leaderboard_entries
  SET genome_id = SHA2(genome, 256)
  WHERE genome_id IS NULL;

-- Tighten: genome_id must always be present going forward.
ALTER TABLE leaderboard_entries
  MODIFY COLUMN genome_id VARCHAR(64) NOT NULL;

-- ── Idempotent-write unique constraint ────────────────────────────────────
-- (leaderboard_name, genome_id) is the natural dedup key.
-- ON DUPLICATE KEY UPDATE can use this to update fitness without inserting duplicates.

ALTER TABLE leaderboard_entries
  ADD UNIQUE KEY IF NOT EXISTS uq_leaderboard_genome (leaderboard_name, genome_id);

-- ── Verified ranking index ────────────────────────────────────────────────
-- Supports ORDER BY verified_fitness DESC per martian_type efficiently.

CREATE INDEX IF NOT EXISTS idx_leaderboard_verified
  ON leaderboard_entries (martian_type, verified_fitness DESC);
