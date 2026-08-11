import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{coverage,reports}/**',
      '.claude/**',
      'MEMORY/**',
      '**/scratch/**',
      // Diagnostic probe namespaces from earlier bug-hunt cycles —
      // collected by the default Vitest glob and break the ship gate.
      // Follow-up to PKT-537/#447 which only covered MEMORY/scratch.
      'test/_probe/**',
      'test/**/_probe*.{ts,mts}',
      'test/**/probe*.{ts,mts}',
    ],
  },
});
