import { describe, it, expect, vi } from 'vitest';

const mockModel     = { id: 'test-model-id' };
const mockResponse  = { content: [{ type: 'text', text: 'result text' }] };

vi.mock('@mariozechner/pi-ai', () => ({
  getEnvApiKey:   vi.fn().mockReturnValue('sk-test'),
  getModel:       vi.fn().mockReturnValue({ id: 'test-model-id' }),
  completeSimple: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result text' }] }),
}));

vi.mock('../../../src/alienclaw/utils.js', () => ({
  extractText: vi.fn().mockReturnValue('result text'),
}));

import { piAiComplete } from '../../../src/alienclaw/governance/common/pi-ai-complete.js';
import { getEnvApiKey, getModel, completeSimple } from '@mariozechner/pi-ai';
import { extractText } from '../../../src/alienclaw/utils.js';

describe('piAiComplete', () => {
  it('wires provider/model/key → completeSimple → extractText and returns the result', async () => {
    const result = await piAiComplete('anthropic', 'claude-3', 'sys prompt', 'user msg');

    expect(getEnvApiKey).toHaveBeenCalledWith('anthropic');
    expect(getModel).toHaveBeenCalledWith('anthropic', 'claude-3');
    expect(completeSimple).toHaveBeenCalledWith(
      mockModel,
      expect.objectContaining({
        systemPrompt: 'sys prompt',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'user msg' }),
        ]),
      }),
      { apiKey: 'sk-test' },
    );
    expect(extractText).toHaveBeenCalledWith(mockResponse);
    expect(result).toBe('result text');
  });
});
