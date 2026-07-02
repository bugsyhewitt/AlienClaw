/**
 * domain-resolver.test.ts — strict domain → martian_type resolution.
 *
 * The resolver replaces the silent `?? 'compute'` campaign default:
 * unknown domains must throw, known ones must bind idempotently, and the
 * binding directory must hold strings only (no live agents).
 */
import { describe, it, expect } from 'vitest';
import { DomainResolver } from '../../src/alienclaw/governance/common/domain-resolver.js';

describe('DomainResolver', () => {
  it('resolves a known martian type to itself', () => {
    const r = new DomainResolver(['compute', 'file_read']);
    expect(r.resolve('compute')).toBe('compute');
  });

  it('resolves an alias to its bound martian type', () => {
    const r = new DomainResolver(['compute'], { math: 'compute' });
    expect(r.resolve('math')).toBe('compute');
  });

  it('rejects an unknown domain with an error naming the known types', () => {
    const r = new DomainResolver(['compute', 'file_read']);
    expect(() => r.resolve('astrology')).toThrow(/unknown domain 'astrology'.*compute, file_read/);
  });

  it('records no binding for a rejected domain', () => {
    const r = new DomainResolver(['compute']);
    expect(() => r.resolve('astrology')).toThrow();
    expect(r.binding('astrology')).toBeUndefined();
    expect(r.bindingCount).toBe(0);
  });

  it('is idempotent — repeat resolves return the same binding without growth', () => {
    const r = new DomainResolver(['compute'], { math: 'compute' });
    expect(r.resolve('math')).toBe('compute');
    expect(r.resolve('math')).toBe('compute');
    expect(r.bindingCount).toBe(1);
    expect(r.binding('math')).toBe('compute');
  });

  it('rejects an alias pointing at an unknown type', () => {
    const r = new DomainResolver(['compute'], { web: 'web_search' });
    expect(() => r.resolve('web')).toThrow(/unknown domain 'web'/);
  });

  it('requires a non-empty knownTypes list', () => {
    expect(() => new DomainResolver([])).toThrow(/knownTypes must be non-empty/);
  });
});
