/**
 * Submission audit log — append-only JSONL with daily rollover.
 * TypeScript port of api/audit_log.py (Packet 31.5).
 *
 * NEVER logs raw API keys or full genome content.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, fsyncSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

interface AuditEntry {
  ts:             string;
  api_key_hash:   string;
  client_ip:      string;
  martian_type:   string;
  genome_sha256:  string;
  fitness:        number;
  result:         'accepted' | 'rejected';
  rejection_code: string | null;
}

export class AuditLog {
  private readonly _root: string | null;

  constructor(opts: { dataRoot?: string } = {}) {
    this._root = opts.dataRoot ?? null;
  }

  private _logPath(date?: string): string | null {
    if (!this._root) return null;
    const d = date ?? todayUtc();
    return join(this._root, 'audit', `submissions-${d}.jsonl`);
  }

  record(opts: {
    apiKeyHash:     string;
    martianType:    string;
    genome:         string;
    fitness:        number;
    result:         'accepted' | 'rejected';
    rejectionCode?: string | null;
    clientIp?:      string;
  }): void {
    const path = this._logPath();
    if (!path) return;

    const entry: AuditEntry = {
      ts:             new Date().toISOString(),
      api_key_hash:   opts.apiKeyHash,
      client_ip:      opts.clientIp ?? 'unknown',
      martian_type:   opts.martianType,
      genome_sha256:  sha256(opts.genome),
      fitness:        opts.fitness,
      result:         opts.result,
      rejection_code: opts.rejectionCode ?? null,
    };
    const line = JSON.stringify(entry, Object.keys(entry).sort() as (keyof AuditEntry)[]) + '\n';

    try {
      const dir = path.slice(0, path.lastIndexOf('/'));
      mkdirSync(dir, { recursive: true });
      const fd = openSync(path, 'a');
      try {
        appendFileSync(fd, line, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch (err) {
      process.stderr.write(`[audit-log] WARNING: failed to write entry: ${err}\n`);
    }
  }
}
