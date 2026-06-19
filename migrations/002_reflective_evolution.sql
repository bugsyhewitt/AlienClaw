-- Migration 002: Reflective Evolution Engine (P14-01)
-- Safe to apply before enabling REFLECTIVE_EVOLUTION flag — additive only.
-- Apply in FK order: re_genome → re_run → re_tool_call/re_error → re_lineage → re_frontier_snapshot
-- Rollback: SET REFLECTIVE_EVOLUTION=off (tables remain inert).
-- Production table drop is an escalation item — never autonomous.

-- ── Genome registry ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS re_genome (
  id           CHAR(64)    NOT NULL PRIMARY KEY,   -- SHA-256 content hash
  raw          CHAR(256)   NOT NULL,
  tool_slots   JSON        NOT NULL,
  editable     JSON        NOT NULL,
  created_at   DATETIME(3) NOT NULL,
  UNIQUE KEY uq_raw (raw)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Martian run (one ExecutionTrace) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS re_run (
  run_id              CHAR(36)     NOT NULL PRIMARY KEY,
  genome_id           CHAR(64)     NOT NULL,
  task_id             VARCHAR(128) NOT NULL,
  seed                BIGINT       NOT NULL,
  final_output        JSON         NULL,
  correctness         DECIMAL(6,5) NOT NULL,
  correctness_source  VARCHAR(32)  NOT NULL,
  correctness_conf    DECIMAL(6,5) NULL,
  input_tokens        INT          NOT NULL,
  output_tokens       INT          NOT NULL,
  dollars             DECIMAL(12,6) NOT NULL,
  tool_calls          INT          NOT NULL,
  wall_ms             INT          NOT NULL,
  started_at          DATETIME(3)  NOT NULL,
  ended_at            DATETIME(3)  NOT NULL,
  KEY ix_run_genome (genome_id),
  KEY ix_run_task   (task_id),
  CONSTRAINT fk_run_genome FOREIGN KEY (genome_id) REFERENCES re_genome(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Tool call detail (ASI) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS re_tool_call (
  run_id  CHAR(36)     NOT NULL,
  idx     INT          NOT NULL,
  tool    VARCHAR(128) NOT NULL,
  args    JSON         NULL,
  result  JSON         NULL,
  ok      TINYINT(1)   NOT NULL,
  ms      INT          NOT NULL,
  note    VARCHAR(512) NULL,
  PRIMARY KEY (run_id, idx),
  CONSTRAINT fk_tc_run FOREIGN KEY (run_id) REFERENCES re_run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Errors ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS re_error (
  run_id  CHAR(36)    NOT NULL,
  seq     INT         NOT NULL,
  kind    VARCHAR(64) NOT NULL,
  message TEXT        NOT NULL,
  PRIMARY KEY (run_id, seq),
  CONSTRAINT fk_err_run FOREIGN KEY (run_id) REFERENCES re_run(run_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Lineage (parent→child edges) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS re_lineage (
  child_id         CHAR(64)    NOT NULL PRIMARY KEY,
  parent_id        CHAR(64)    NULL,
  op               ENUM('seed','mutate','merge') NOT NULL,
  component        VARCHAR(128) NULL,
  diagnosis        TEXT        NULL,
  lesson           TEXT        NULL,
  prompt_hash      CHAR(64)    NULL,
  reflector_model  VARCHAR(64) NULL,
  created_at       DATETIME(3) NOT NULL,
  KEY ix_lin_parent (parent_id),
  CONSTRAINT fk_lin_child FOREIGN KEY (child_id) REFERENCES re_genome(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Pareto frontier snapshots ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS re_frontier_snapshot (
  snapshot_id  CHAR(36)    NOT NULL,
  genome_id    CHAR(64)    NOT NULL,
  generation   INT         NOT NULL,
  aggregate    JSON        NOT NULL,                -- ObjectiveVector
  created_at   DATETIME(3) NOT NULL,
  PRIMARY KEY (snapshot_id, genome_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
