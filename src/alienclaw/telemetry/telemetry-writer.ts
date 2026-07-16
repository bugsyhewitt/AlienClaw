/**
 * telemetry-writer.ts
 * Writes structured telemetry records to ~/.alienclaw/registry/telemetry/<ISO-date>/
 *
 * Three file types:
 *   <report_code>.json         — Martian execution reports
 *   failforward_<ts>.json      — escalation / failforward events
 *   advisory_<taskId>.json     — AdvisorBot advisory sessions
 *
 * Security: caller-supplied filename segments (reportCode, taskId) are run
 * through {@link sanitizeFilenameSegment} before any path is built. This closes
 * a path-traversal write primitive — without it a reportCode like
 * "../../../etc/cron.d/x" or one containing a path separator would let a caller
 * write JSON outside the dated telemetry directory. failforward filenames are
 * derived solely from a numeric timestamp we generate, so they carry no
 * caller-controlled traversal surface.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, sep }        from 'node:path';
import { PATHS }            from '../constants.js';
import { dateStamp }        from '../utils.js';

/**
 * Allowed characters for a telemetry filename segment.
 * Mirrors the universe of the segments the system actually emits — Base62
 * report codes ([A-Za-z0-9]) plus '_' and '-' for prefixed/derived ids — while
 * excluding every byte that could escape the target directory (path
 * separators, '.', NUL, whitespace, shell/glob metacharacters).
 */
const FILENAME_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/** Maximum length of a single filename segment (defensive bound). */
const FILENAME_SEGMENT_MAX = 128;

/**
 * Thrown when a caller-supplied filename segment fails validation.
 * Named so callers and tests can assert on a stable type rather than message text.
 */
export class TelemetryFilenameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetryFilenameError';
  }
}

/**
 * Validate a caller-supplied filename segment and return it unchanged.
 *
 * This is a *reject* sanitizer (allowlist), not a strip sanitizer: silently
 * rewriting an attacker-controlled value can collapse two distinct ids onto one
 * file or mask a probe, so anything outside the `[A-Za-z0-9_-]` allowlist is a
 * hard error. High-signal traversal vectors (path separators, '..', NUL) are
 * checked first so the thrown message is diagnostic.
 *
 * @param value  the raw segment (e.g. a reportCode or taskId)
 * @param label  human-readable name of the field, used in error messages
 * @returns the validated segment, guaranteed safe to interpolate into a filename
 * @throws {TelemetryFilenameError} if the segment is empty, too long, or
 *         contains any character outside the allowlist
 */
export function sanitizeFilenameSegment(value: string, label = 'filename segment'): string {
  if (typeof value !== 'string') {
    throw new TelemetryFilenameError(
      `Invalid ${label}: expected a string, got ${typeof value}.`,
    );
  }
  if (value.length === 0) {
    throw new TelemetryFilenameError(`Invalid ${label}: must not be empty.`);
  }
  if (value.length > FILENAME_SEGMENT_MAX) {
    throw new TelemetryFilenameError(
      `Invalid ${label}: exceeds ${FILENAME_SEGMENT_MAX} characters.`,
    );
  }

  // Explicit checks for the dangerous vectors, for clearer diagnostics. These
  // are subsumed by the allowlist below but produce a more useful message.
  if (value.includes('\0')) {
    throw new TelemetryFilenameError(`Invalid ${label}: contains a NUL byte.`);
  }
  if (value.includes('/') || value.includes('\\') || value.includes(sep)) {
    throw new TelemetryFilenameError(
      `Path traversal rejected: ${label} "${value}" contains a path separator.`,
    );
  }
  if (value.includes('..')) {
    throw new TelemetryFilenameError(
      `Path traversal rejected: ${label} "${value}" contains "..".`,
    );
  }

  // Allowlist gate — the authoritative rule.
  if (!FILENAME_SEGMENT_RE.test(value)) {
    throw new TelemetryFilenameError(
      `Invalid ${label}: "${value}" contains characters outside [A-Za-z0-9_-].`,
    );
  }

  return value;
}

export class TelemetryWriter {
  private dirForDate(date: Date = new Date()): string {
    return join(PATHS.telemetry, dateStamp(date));
  }

  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  /**
   * Write a Martian execution report.
   * Filename: <reportCode>.json
   */
  async writeMartianReport(reportCode: string, data: Record<string, unknown>): Promise<void> {
    const safeCode = sanitizeFilenameSegment(reportCode, 'reportCode');
    const dir = this.dirForDate();
    await this.ensureDir(dir);
    const payload = { reportCode, ts: Date.now(), ...data };
    await writeFile(
      join(dir, `${safeCode}.json`),
      JSON.stringify(payload, null, 2),
      'utf-8',
    );
  }

  /**
   * Write a failforward / escalation event record.
   * Filename: failforward_<ts>.json
   *
   * The timestamp is generated internally (numeric), so there is no
   * caller-controlled segment to sanitize here.
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
    const safeTaskId = sanitizeFilenameSegment(taskId, 'taskId');
    const dir = this.dirForDate();
    await this.ensureDir(dir);
    const payload = { taskId, ts: Date.now(), ...data };
    await writeFile(
      join(dir, `advisory_${safeTaskId}.json`),
      JSON.stringify(payload, null, 2),
      'utf-8',
    );
  }
}

export const telemetryWriter = new TelemetryWriter();
