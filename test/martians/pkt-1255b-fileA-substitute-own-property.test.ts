/**
 * PKT-1255 File-A — substitute() field-presence must use own-property semantics.
 * Append-only; matches the existing substitution.test.ts style (exact throw-message
 * assertions). A-1..A-5 are RED at unmodified HEAD (the `in` operator walks the
 * prototype chain); A-6/A-7 are acceptance cases that pass before AND after the fix.
 */
import { describe, it, expect } from 'vitest';
import { substitute } from '../../src/alienclaw/martians/substitution.js';

describe('substitute() field-presence check must use own-property (PKT-1255)', () => {
  // ---- slot-output side (substitution.ts:63) ----
  it('A-1 rejects inherited slot-output field toString', () => {
    expect(() => substitute('X=${slot[0].output.toString}', [{}], {}))
      .toThrow("Slot 0 output has no field 'toString'.");
  });

  it('A-2 rejects inherited slot-output field constructor', () => {
    expect(() => substitute('X=${slot[0].output.constructor}', [{}], {}))
      .toThrow("Slot 0 output has no field 'constructor'.");
  });

  it('A-3 rejects inherited slot-output field __proto__ (own keys unrelated)', () => {
    expect(() => substitute('X=${slot[0].output.__proto__}', [{ real: 1 }], {}))
      .toThrow("Slot 0 output has no field '__proto__'.");
  });

  // ---- campaign side (substitution.ts:71) ----
  it('A-4 rejects inherited campaign field hasOwnProperty', () => {
    expect(() => substitute('${campaign.hasOwnProperty}', [], {}))
      .toThrow("Campaign inputs has no field 'hasOwnProperty'.");
  });

  it('A-5 rejects inherited campaign field valueOf, listing only own keys', () => {
    let message = '';
    try {
      substitute('${campaign.valueOf}', [], { zebra: 1, apple: 2 });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe("Campaign inputs has no field 'valueOf'. Available: apple, zebra");
  });

  // ---- acceptance (non-regression; green before AND after the fix) ----
  it('A-6 still resolves an OWN property that shadows a prototype member', () => {
    expect(substitute('${campaign.toString}', [], { toString: 'shadowed' })).toBe('shadowed');
    expect(substitute('${slot[0].output.valueOf}', [{ valueOf: 'own' }], {})).toBe('own');
  });

  it('A-7 still resolves ordinary own fields unchanged', () => {
    expect(substitute('${campaign.q}/${slot[0].output.n}', [{ n: 7 }], { q: 'cats' })).toBe('cats/7');
  });
});
