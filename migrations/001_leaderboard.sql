-- Migration 001: AlienClaw community API schema
-- Run against the Hostinger MySQL database (u881291242_leaderboard).
-- All three server stores: submissions, installs, (stats derived via queries).
-- Database-level constraints enforce policies as defense-in-depth beyond app validation.

-- ── Genome submissions (leaderboard) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leaderboard_entries (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    submission_id     VARCHAR(32)  NOT NULL UNIQUE,
    leaderboard_name  CHAR(8)      NOT NULL,
    genome            VARCHAR(256) NOT NULL,
    martian_type      VARCHAR(64)  NOT NULL,
    fitness           DOUBLE       NOT NULL,
    api_key_hash      VARCHAR(64)  NOT NULL,
    submitted_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    run_metadata      JSON,

    -- Defense-in-depth: enforce the 8-uppercase-letter constraint at the DB level
    CONSTRAINT chk_leaderboard_name
        CHECK (leaderboard_name REGEXP '^[A-Z]{8}$'),

    -- Fitness must be in [0, 1]
    CONSTRAINT chk_fitness
        CHECK (fitness >= 0.0 AND fitness <= 1.0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Top-N per martian_type query (the leaderboard read path)
CREATE INDEX IF NOT EXISTS idx_leaderboard_martian_fitness
    ON leaderboard_entries (martian_type, fitness DESC);

-- Rank-for-fitness query (count submissions above a given fitness)
CREATE INDEX IF NOT EXISTS idx_leaderboard_martian_fitness_asc
    ON leaderboard_entries (martian_type, fitness);

-- Deduplication check (same genome + type + key + recent window)
CREATE INDEX IF NOT EXISTS idx_leaderboard_dedup
    ON leaderboard_entries (genome(64), martian_type, api_key_hash, submitted_at);

-- Operator name lookup
CREATE INDEX IF NOT EXISTS idx_leaderboard_name
    ON leaderboard_entries (leaderboard_name);

-- ── Installs ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS installs (
    install_id    VARCHAR(32)  NOT NULL PRIMARY KEY,
    api_key_hash  VARCHAR(64)  NOT NULL UNIQUE,
    machine_hash  VARCHAR(64)  NOT NULL,
    registered_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Stats ─────────────────────────────────────────────────────────────────────
-- GlobalStats are DERIVED at query time from the two tables above using SQL
-- aggregate functions (COUNT, MAX, GROUP BY). No mutable stats row is needed;
-- derived stats cannot drift from reality.
--
-- Queries used by GlobalStats.get():
--   total_genomes:             SELECT COUNT(*) FROM leaderboard_entries
--   total_installs:            SELECT COUNT(*) FROM installs
--   total_fitness_evaluations: SELECT COUNT(*) FROM leaderboard_entries
--   top_fitness_by_type:       SELECT martian_type, MAX(fitness) FROM leaderboard_entries
--                              GROUP BY martian_type
