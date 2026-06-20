/**
 * substitution.test.ts — dedicated coverage for the TypeScript variable
 * substitution engine (src/alienclaw/martians/substitution.ts).
 *
 * Mirrors the Python suite (test/martians/test_substitution.py) and exercises
 * every branch of substitute() / resolveInputs():
 *   - campaign field hit + miss (with sorted "Available:" message)
 *   - slot field hit + miss (with sorted "Available:" message)
 *   - forward / self / out-of-range slot reference (tightened wording)
 *   - non-string JSON.stringify coercion (number, bool, array, object, null)
 *   - multiple tokens in a single template
 *   - resolveInputs null-wiring passthrough + field resolution
 *
 * NOTE: error-message assertions are intentionally exact for the "Available:"
 * lists so a regression in the sort/join formatting is caught immediately.
 */
import { describe, it, expect } from 'vitest';
import { substitute, resolveInputs } from '../../src/alienclaw/martians/substitution.js';
import type { InputWiring } from '../../src/alienclaw/martians/types.js';

describe('substitute() — campaign namespace', () => {
  it('resolves a campaign field (string passthrough)', () => {
    expect(substitute('${campaign.query}', [], { query: 'hello' })).toBe('hello');
  });

  it('resolves a campaign field embedded in surrounding text', () => {
    expect(substitute('q=${campaign.q}!', [], { q: 'cats' })).toBe('q=cats!');
  });

  it('throws when a campaign field is missing, naming the field', () => {
    expect(() => substitute('${campaign.missing}', [], { present: 1 }))
      .toThrow("Campaign inputs has no field 'missing'.");
  });

  it('lists available campaign fields sorted, exact "Available:" output', () => {
    let message = '';
    try {
      substitute('${campaign.missing}', [], { zebra: 1, apple: 2, mango: 3 });
    } catch (e) {
      message = (e as Error).message;
    }
    // sorted alphabetically, comma-space joined — assert the exact tail.
    expect(message).toContain('Available: apple, mango, zebra');
    // and assert there is no trailing junk after the last key.
    expect(message.endsWith('Available: apple, mango, zebra')).toBe(true);
  });

  it('reports an empty "Available:" list when no campaign fields exist', () => {
    expect(() => substitute('${campaign.x}', [], {}))
      .toThrow("Campaign inputs has no field 'x'. Available: ");
  });
});

describe('substitute() — slot namespace (hit / miss)', () => {
  it('resolves a slot output field (string passthrough)', () => {
    expect(substitute('${slot[0].output.body}', [{ body: 'content' }], {}))
      .toBe('content');
  });

  it('resolves the correct slot when multiple prior slots exist', () => {
    const slots = [{ a: 'first' }, { a: 'second' }];
    expect(substitute('${slot[1].output.a}', slots, {})).toBe('second');
  });

  it('throws when the slot field is missing, naming the field', () => {
    expect(() => substitute('${slot[0].output.x}', [{ y: 1 }], {}))
      .toThrow("Slot 0 output has no field 'x'.");
  });

  it('lists available slot fields sorted, exact "Available:" output', () => {
    let message = '';
    try {
      substitute('${slot[0].output.nope}', [{ delta: 1, alpha: 2, charlie: 3, bravo: 4 }], {});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(
      "Slot 0 output has no field 'nope'. Available: alpha, bravo, charlie, delta",
    );
  });

  it('reports an empty "Available:" list when the slot output is empty', () => {
    expect(() => substitute('${slot[0].output.x}', [{}], {}))
      .toThrow("Slot 0 output has no field 'x'. Available: ");
  });
});

describe('substitute() — forward / self / out-of-range slot references', () => {
  it('throws a forward-reference error for slot[1] when only slot 0 exists', () => {
    expect(() => substitute('${slot[1].output.x}', [{ y: 1 }], {}))
      .toThrow(/forward\/self reference/);
  });

  it('forward-reference message names the bad slot and prior-slot count', () => {
    let message = '';
    try {
      substitute('${slot[2].output.x}', [{ a: 1 }, { b: 2 }], {});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('Substitution references slot[2].output.x');
    expect(message).toContain('but only 2 prior slot(s) have output.');
    expect(message).toContain('forward/self reference');
    // two prior slots → valid indices 0..1
    expect(message).toContain('valid indices are 0..1');
  });

  it('self-reference (slot index == own position) is reported as forward/self', () => {
    // A slot mistakenly included in its own slotOutputs would still be absent
    // at substitution time; index 0 against an empty prior-output list is the
    // canonical "references its own slot" case.
    let message = '';
    try {
      substitute('${slot[0].output.field}', [], {});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('Substitution references slot[0].output.field');
    expect(message).toContain('but only 0 prior slot(s) have output.');
    expect(message).toContain('forward/self reference');
    // empty prior outputs → no range, friendly phrasing (not "0..-1")
    expect(message).toContain('no prior slot outputs are available');
    expect(message).not.toContain('0..-1');
  });

  it('far out-of-range index uses the same forward/self framing', () => {
    let message = '';
    try {
      substitute('${slot[99].output.x}', [{ a: 1 }], {});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('slot[99].output.x');
    expect(message).toContain('but only 1 prior slot(s) have output.');
    expect(message).toContain('forward/self reference');
    expect(message).toContain('valid indices are 0..0');
  });

  it('does not throw a forward-reference error for a valid prior slot', () => {
    expect(() => substitute('${slot[0].output.a}', [{ a: 'ok' }], {})).not.toThrow();
  });
});

describe('substitute() — non-string JSON.stringify coercion', () => {
  it('coerces a number via JSON.stringify', () => {
    expect(substitute('${slot[0].output.count}', [{ count: 42 }], {})).toBe('42');
  });

  it('coerces a boolean to lowercase json literal', () => {
    expect(substitute('${slot[0].output.ok}', [{ ok: true }], {})).toBe('true');
    expect(substitute('${slot[0].output.ok}', [{ ok: false }], {})).toBe('false');
  });

  it('coerces an array via JSON.stringify (no inner spaces)', () => {
    expect(substitute('${slot[0].output.matches}', [{ matches: [1, 2, 3] }], {}))
      .toBe('[1,2,3]');
  });

  it('coerces an object via JSON.stringify (no inner spaces)', () => {
    expect(substitute('${slot[0].output.cfg}', [{ cfg: { b: 1, a: 2 } }], {}))
      .toBe('{"b":1,"a":2}');
  });

  it('coerces null via JSON.stringify', () => {
    expect(substitute('${slot[0].output.n}', [{ n: null }], {})).toBe('null');
  });

  it('coerces a campaign-side non-string value too', () => {
    expect(substitute('${campaign.limit}', [], { limit: 7 })).toBe('7');
  });
});

describe('substitute() — multiple tokens and passthrough', () => {
  it('returns plain text unchanged when there are no tokens', () => {
    expect(substitute('plain text', [], {})).toBe('plain text');
  });

  it('resolves multiple tokens across both namespaces in one template', () => {
    const result = substitute(
      '${campaign.a} and ${slot[0].output.b}',
      [{ b: 'B' }],
      { a: 'A' },
    );
    expect(result).toBe('A and B');
  });

  it('resolves repeated and mixed tokens (campaign + two slots, with coercion)', () => {
    const result = substitute(
      'start ${campaign.name}=${slot[0].output.id}/${slot[1].output.score} end ${campaign.name}',
      [{ id: 'X' }, { score: 9 }],
      { name: 'job' },
    );
    expect(result).toBe('start job=X/9 end job');
  });

  it('fails on the first bad token even when valid tokens precede it', () => {
    expect(() =>
      substitute('${campaign.ok} ${slot[0].output.missing}', [{ other: 1 }], { ok: 'y' }),
    ).toThrow("Slot 0 output has no field 'missing'.");
  });
});

describe('resolveInputs()', () => {
  it('returns a shallow copy of campaign inputs when wiring is null', () => {
    const campaign = { a: '1', b: 2 };
    const result = resolveInputs(null, [], campaign);
    expect(result).toEqual({ a: '1', b: 2 });
    // must be a copy, not the same reference
    expect(result).not.toBe(campaign);
  });

  it('resolves each wired field template', () => {
    const wiring: InputWiring = { fields: { json: '${slot[0].output.body}' } };
    const result = resolveInputs(wiring, [{ body: '{"x":1}' }], {});
    expect(result).toEqual({ json: '{"x":1}' });
  });

  it('resolves multiple wired fields drawing from both namespaces', () => {
    const wiring: InputWiring = {
      fields: { q: '${campaign.query}', prev: '${slot[0].output.text}' },
    };
    const result = resolveInputs(wiring, [{ text: 'prior' }], { query: 'now' });
    expect(result).toEqual({ q: 'now', prev: 'prior' });
  });

  it('propagates substitution errors from a wired field', () => {
    const wiring: InputWiring = { fields: { bad: '${campaign.nope}' } };
    expect(() => resolveInputs(wiring, [], { other: 1 }))
      .toThrow("Campaign inputs has no field 'nope'.");
  });
});
