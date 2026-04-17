/**
 * telemetry-writer.ts
 * Writes structured telemetry records to ~/.alienclaw/registry/telemetry/<ISO-date>/
 *
 * Three file types:
 *   <report_code>.json         — Martian execution reports
 *   failforward_<ts>.json      — escalation / failforward events
 *   advisory_<taskId>.json     — AdvisorBot advisory sessions
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join }              from 'node:path';
import { PATHS }             from '../constants.js';

export class TelemetryWriter {
  private dirForDate(date: Date = new Date()): string {
    return join(PATHS.telemetry, date.toISOString().slice(0, 10));
  }

  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  /**
   * Write a Martian execution report.
   * Filename: <reportCode>.json
   */
  async writeMartianReport(reportCode: string, data: Record<string, unknown>): Promise<void> {
    const dir = this.dirForDate();
    await this.ensureDir(dir);
    const payload = { reportCode, ts: Date.now(), ...data };
    await writeFile(
      join(dir, `${reportCode}.json`),
      JSON.stringify(payload, null, 2),
      'utf-8',
    );
  }

  /**
   * Write a failforward / escalation event record.
   * Filename: failforward_<ts>.json
   */
  async writeFailforward(data: Record<string, unknown>): Promise<void> {
    const dir = this.dirForDate();
    await this.ensureDir(dir);
    const ts      = Date.now();
    const payload = { ts, ...data };
    await writeFile(
      join(dir, `failforward_${ts}.json`),
      JSON.stringify(payload, null, 2),
      'utf-8',
    );
  }

  /**
   * Write an advisory session record.
   * Filename: advisory_<taskId>.json  (overwrites if called again for the same taskId/day)
   */
  async writeAdvisory(taskId: string, data: Record<string, unknown>): Promise<void> {
    const dir = this.dirForDate();
    await this.ensureDir(dir);
    const payload = { taskId, ts: Date.now(), ...data };
    await writeFile(
      join(dir, `advisory_${taskId}.json`),
      JSON.stringify(payload, null, 2),
      'utf-8',
    );
  }
}

export const telemetryWriter = new TelemetryWriter();
