import { describe, it, expect, beforeEach } from 'vitest';
import { Logger, InMemorySink, JsonStdoutSink } from '../../src/alienclaw/governance/common/logger.js';

describe('Logger / InMemorySink', () => {
  let sink: InMemorySink;
  let log: Logger;

  beforeEach(() => {
    sink = new InMemorySink();
    log  = new Logger(sink, 'TestSource');
  });

  it('emits info entries with correct shape', () => {
    log.info('test-event', { x: 1 }, 'corr-1');
    expect(sink.entries).toHaveLength(1);
    const e = sink.entries[0]!;
    expect(e.level).toBe('info');
    expect(e.source).toBe('TestSource');
    expect(e.event).toBe('test-event');
    expect(e.data).toEqual({ x: 1 });
    expect(e.correlation_id).toBe('corr-1');
    expect(new Date(e.timestamp).toISOString()).toBe(e.timestamp);
  });

  it('emits debug, warn, error levels', () => {
    log.debug('dbg', {}, 'c');
    log.warn('wrn', {}, 'c');
    log.error('err', {}, 'c');
    const levels = sink.entries.map(e => e.level);
    expect(levels).toEqual(['debug', 'warn', 'error']);
  });

  it('works without data and correlation_id', () => {
    log.info('bare-event');
    const e = sink.entries[0]!;
    expect(e.event).toBe('bare-event');
    expect(e.data).toBeUndefined();
    expect(e.correlation_id).toBeUndefined();
  });

  it('byEvent filters correctly', () => {
    log.info('a'); log.info('b'); log.info('a');
    expect(sink.byEvent('a')).toHaveLength(2);
    expect(sink.byEvent('b')).toHaveLength(1);
    expect(sink.byEvent('c')).toHaveLength(0);
  });

  it('bySource filters correctly', () => {
    const sink2 = new InMemorySink();
    const log2  = new Logger(sink2, 'OtherSource');
    log.info('from-test', {}, undefined);
    log2.info('from-other', {}, undefined);
    // each logger has its own sink
    expect(sink.bySource('TestSource')).toHaveLength(1);
    expect(sink2.bySource('OtherSource')).toHaveLength(1);
  });

  it('clear() empties entries', () => {
    log.info('e1'); log.info('e2');
    expect(sink.entries).toHaveLength(2);
    sink.clear();
    expect(sink.entries).toHaveLength(0);
  });
});

describe('JsonStdoutSink', () => {
  it('constructs without throwing', () => {
    expect(() => new JsonStdoutSink()).not.toThrow();
  });
});
