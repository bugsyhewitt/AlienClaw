-- Migration 004: Verified fitness split and genome identity for idempotent writes.
-- ADDITIVE ONLY — no column renames or drops.
-- The existing `fitness` column remains and represents client-reported fitness.
--
-- The migrate.ts runner tracks applied files in schema_migrations, so these
-- statements run exactly once — no IF NOT EXISTS guards needed (those are
-- MariaDB syntax; this targets MySQL 8.0).

-- ── Verified fitness columns ──────────────────────────────────────────────
-- These are NULL until the P6 server-side verifier sets them.

ALTER TABLE leaderboard_entries
  ADD COLUMN verified_fitness  DOUBLE       NULL,
  ADD COLUMN verified_at       DATETIME     NULL,
  ADD COLUMN suite_version     VARCHAR(32)  NULL,
  ADD COLUMN evaluator_version VARCHAR(32)  NULL,
  ADD COLUMN fitness_version   VARCHAR(16)  NULL,
  ADD COLUMN msb_version       VARCHAR(16)  NULL,
  ADD COLUMN genome_version    VARCHAR(16)  NULL;

-- ── Genome identity column ────────────────────────────────────────────────
-- genome_id = SHA2(genome, 256). Used as the deduplication key so that
-- re-submissions of the same genome do not create duplicate rows.

ALTER TABLE leaderboard_entries
  ADD COLUMN genome_id VARCHAR(64) NULL;

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
  ADD UNIQUE KEY uq_leaderboard_genome (leaderboard_name, genome_id);

-- ── Verified ranking index ────────────────────────────────────────────────
-- Supports ORDER BY COALESCE(verified_fitness, -1) DESC per martian_type.

CREATE INDEX idx_leaderboard_verified
  ON leaderboard_entries (martian_type, verified_fitness DESC);
