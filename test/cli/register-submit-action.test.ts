/**
 * register-submit-action.test.ts — action callback coverage for registerSubmitCommand.
 *
 * Kept separate from register-submit.test.ts so the vi.mock for submit.js does not
 * interfere with the real runSubmit integration tests in that file.
 * Follows the same pattern as register-evolve.test.ts L160-178.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Command } from 'commander';

vi.mock('../../src/alienclaw/cli/submit.js', async (importActual) => {
  const actual = await importActual() as Record<string, unknown>;
  return { ...actual, runSubmit: vi.fn().mockResolvedValue(0) };
});

import { registerSubmitCommand } from '../../src/alienclaw/cli/register.submit.js';

function makeFakeProgram(): {
  program: Command;
  lastAction: () => ((...args: unknown[]) => unknown) | null;
} {
  let _action: ((...args: unknown[]) => unknown) | null = null;
  const program: Command = {
    command:        () => program,
    description:    () => program,
    option:         () => program,
    requiredOption: () => program,
    addHelpText:    () => program,
    action:         (fn: (...args: unknown[]) => unknown) => { _action = fn; return program; },
  } as unknown as Command;
  return { program, lastAction: () => _action };
}

describe('registerSubmitCommand — action callback', () => {
  it('invokes runSubmit with the correct opts when action fires', async () => {
    const fake = makeFakeProgram();
    registerSubmitCommand(fake.program);
    const action = fake.lastAction() as (opts: Record<string, unknown>) => Promise<void>;
    await action({ type: 'compute_alone', name: 'TESTBOT', yes: true, force: false });
    const { runSubmit } = await import('../../src/alienclaw/cli/submit.js');
    expect(runSubmit).toHaveBeenCalledWith({
      martianType: 'compute_alone',
      name:        'TESTBOT',
      yes:         true,
      force:       false,
    });
  });

  it('coerces yes/force to false when opts are absent', async () => {
    const fake = makeFakeProgram();
    registerSubmitCommand(fake.program);
    const action = fake.lastAction() as (opts: Record<string, unknown>) => Promise<void>;
    await action({ type: 'compute_alone' });
    const { runSubmit } = await import('../../src/alienclaw/cli/submit.js');
    expect(runSubmit).toHaveBeenCalledWith({
      martianType: 'compute_alone',
      name:        undefined,
      yes:         false,
      force:       false,
    });
  });
});
