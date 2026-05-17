-- Migration 001: Leaderboard schema
-- Run against the Hostinger MySQL database.
-- Database-level constraints enforce the leaderboard_name policy
-- as defense in depth beyond application-level validation.

CREATE TABLE IF NOT EXISTS leaderboard_entries (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    leaderboard_name  CHAR(8) NOT NULL,
    genome            VARCHAR(256) NOT NULL,
    martian_type      VARCHAR(64) NOT NULL,
    fitness           DOUBLE NOT NULL,
    api_key_hash      VARCHAR(64) NOT NULL,
    submitted_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submission_id     VARCHAR(32) NOT NULL UNIQUE,
    run_metadata      JSON,

    -- Enforce the 8-uppercase-letter constraint at the database level
    CONSTRAINT chk_leaderboard_name
        CHECK (leaderboard_name REGEXP '^[A-Z]{8}$'),

    -- Fitness must be in [0, 1]
    CONSTRAINT chk_fitness
        CHECK (fitness >= 0.0 AND fitness <= 1.0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Index for leaderboard queries: top N per martian_type sorted by fitness desc
CREATE INDEX IF NOT EXISTS idx_leaderboard_martian_fitness
    ON leaderboard_entries (martian_type, fitness DESC);

-- Index for looking up by operator name
CREATE INDEX IF NOT EXISTS idx_leaderboard_name
    ON leaderboard_entries (leaderboard_name);

-- Index for deduplication check
CREATE INDEX IF NOT EXISTS idx_leaderboard_genome_type
    ON leaderboard_entries (genome(64), martian_type);
