/**
 * Structured logger for the Packet 6 governance loop.
 *
 * Every state transition, message send, and agent action emits a log entry
 * with: timestamp, level, source, event, correlation_id, data.
 *
 * Tests inject an InMemorySink to assert the expected log sequence after
 * a complete goal run. Production code uses JsonStdoutSink (JSONL to stdout).
 */

export interface LogEntry {
  timestamp:      string;
  level:          'debug' | 'info' | 'warn' | 'error';
  source:         string;
  event:          string;
  correlation_id?: string;
  data?:          Record<string, unknown>;
}

// ── Sinks ──────────────────────────────────────────────────────────────────

export interface LogSink {
  emit(entry: LogEntry): void;
}

/** Writes JSONL to stdout — default for production. */
export class JsonStdoutSink implements LogSink {
  emit(entry: LogEntry): void {
    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}

/** Accumulates entries in memory — for tests. */
export class InMemorySink implements LogSink {
  readonly entries: LogEntry[] = [];

  emit(entry: LogEntry): void {
    this.entries.push(entry);
  }

  /** Remove all accumulated entries. */
  clear(): void {
    this.entries.length = 0;
  }

  /** Filter entries by event name. */
  byEvent(event: string): LogEntry[] {
    return this.entries.filter(e => e.event === event);
  }

  /** Filter entries by source agent. */
  bySource(source: string): LogEntry[] {
    return this.entries.filter(e => e.source === source);
  }
}

// ── Logger ─────────────────────────────────────────────────────────────────

export class Logger {
  constructor(
    private readonly sink:   LogSink,
    private readonly source: string,
  ) {}

  private _emit(
    level:          LogEntry['level'],
    event:          string,
    data?:          Record<string, unknown>,
    correlation_id?: string,
  ): void {
    this.sink.emit({
      timestamp: new Date().toISOString(),
      level,
      source: this.source,
      event,
      correlation_id,
      data,
    });
  }

  info(event: string, data?: Record<string, unknown>, correlation_id?: string): void {
    this._emit('info', event, data, correlation_id);
  }

  debug(event: string, data?: Record<string, unknown>, correlation_id?: string): void {
    this._emit('debug', event, data, correlation_id);
  }

  warn(event: string, data?: Record<string, unknown>, correlation_id?: string): void {
    this._emit('warn', event, data, correlation_id);
  }

  error(event: string, data?: Record<string, unknown>, correlation_id?: string): void {
    this._emit('error', event, data, correlation_id);
  }
}
