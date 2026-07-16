-- Migration 003: Graph Evolution (P14-02)
-- Additive. Apply after 002_reflective_evolution.sql.
-- FK order: re_subagent_genome → re_topology_genome → re_topology_subagent; re_graph_violation standalone.
-- Rollback: SET EVOLVE_TOPOLOGY=off — tables remain inert.

CREATE TABLE IF NOT EXISTS re_subagent_genome (
  id                CHAR(64)     NOT NULL PRIMARY KEY,
  role              TEXT         NOT NULL,
  decomposition     TEXT         NOT NULL,
  summoning_policy  JSON         NOT NULL,
  operators         JSON         NOT NULL,
  report_shape      JSON         NOT NULL,
  created_at        DATETIME(3)  NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS re_topology_genome (
  id              CHAR(64)     NOT NULL PRIMARY KEY,
  subagent_ids    JSON         NOT NULL,
  partition       JSON         NOT NULL,
  compose         ENUM('concat','merge','adjudicate') NOT NULL,
  created_at      DATETIME(3)  NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS re_topology_subagent (
  topology_id   CHAR(64) NOT NULL,
  subagent_id   CHAR(64) NOT NULL,
  PRIMARY KEY (topology_id, subagent_id),
  CONSTRAINT fk_ts_top  FOREIGN KEY (topology_id)  REFERENCES re_topology_genome(id),
  CONSTRAINT fk_ts_sub  FOREIGN KEY (subagent_id)  REFERENCES re_subagent_genome(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS re_graph_violation (
  id            CHAR(36)  NOT NULL PRIMARY KEY,
  artifact_kind ENUM('subagent','topology') NOT NULL,
  artifact_id   CHAR(64)  NULL,
  violation     TEXT      NOT NULL,
  created_at    DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add artifact_kind discriminator to shared lineage/frontier tables
-- Default 'leaf' preserves Packet 01 semantics for all existing rows
ALTER TABLE re_lineage
  ADD COLUMN IF NOT EXISTS artifact_kind ENUM('leaf','subagent','topology') NOT NULL DEFAULT 'leaf';

ALTER TABLE re_frontier_snapshot
  ADD COLUMN IF NOT EXISTS artifact_kind ENUM('leaf','subagent','topology') NOT NULL DEFAULT 'leaf';
