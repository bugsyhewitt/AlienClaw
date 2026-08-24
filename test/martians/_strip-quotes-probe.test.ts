import { describe, it, expect } from 'vitest';
import { parseMartian } from '../../src/alienclaw/martians/parser.js';

describe('PKT-923 probe — _stripQuotes escape ordering bug', () => {
  it('"\\\\n" should be literal backslash+n (YAML: \\ + n), NOT newline', () => {
    // Source string in YAML: "\\n" (backslash + backslash + n)
    // YAML interpretation: \\ → \, n → n. Result: "\n" (backslash + n, 2 chars).
    // CURRENT BUG: regex replaces \\ → \ first, then \n → newline. Result: newline (1 char).
    const md = `
martian_type: "\\\\n"
slots:
  - slot_index: 0
    tool_name: t
`;
    const spec = parseMartian(md);
    console.log('GOT:', JSON.stringify(spec.martianType));
    // Expected: "\n" (backslash + n, 2 chars)
    // Buggy:    "\n" (newline, 1 char)
    expect(spec.martianType).toBe('\\n');
  });

  it('"\\\\t" should be literal backslash+t, NOT tab', () => {
    const md = `
martian_type: "\\\\t"
slots:
  - slot_index: 0
    tool_name: t
`;
    const spec = parseMartian(md);
    console.log('GOT tab:', JSON.stringify(spec.martianType));
    expect(spec.martianType).toBe('\\t');
  });

  it('"\\\\\"" should be literal backslash+quote, NOT just quote', () => {
    // Source: "\\\""
    // YAML: \\ → \, \" → ". Result: \" (backslash + quote, 2 chars).
    // CURRENT: \" → " first → "\"". Then \\ → \ → \" (backslash + quote).
    // Hmm — actually for this case both orderings happen to produce the same result.
    const md = `
martian_type: "\\\\\\""
slots:
  - slot_index: 0
    tool_name: t
`;
    const spec = parseMartian(md);
    console.log('GOT quote:', JSON.stringify(spec.martianType));
    expect(spec.martianType).toBe('\\"');
  });

  it('"\\\\\\\\n" should be literal backslash+backslash+n (3 chars), not backslash+newline', () => {
    // Source: "\\\\n" (4 backslashes + n, 5 chars)
    // YAML: \\ → \, \\ → \, n → n. Result: \\n (3 chars: 2 backslashes + n).
    // CURRENT: replace \\ → \ first. 4 backslashes → 2 backslashes. Then \n matches. → \ + newline (2 chars).
    const md = `
martian_type: "\\\\\\\\n"
slots:
  - slot_index: 0
    tool_name: t
`;
    const spec = parseMartian(md);
    console.log('GOT 4bs:', JSON.stringify(spec.martianType));
    expect(spec.martianType).toBe('\\\\n');
  });

  it('"\\n" should be a newline (correct case, single-letter escape)', () => {
    const md = `
martian_type: "\\n"
slots:
  - slot_index: 0
    tool_name: t
`;
    const spec = parseMartian(md);
    console.log('GOT simple newline:', JSON.stringify(spec.martianType));
    expect(spec.martianType).toBe('\n');
  });
});
