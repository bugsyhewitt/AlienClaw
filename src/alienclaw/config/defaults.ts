import type { AlienClawConfig, UserPreferences } from '../types.js';

export const DEFAULT_CONFIG: AlienClawConfig = {
  version:     '2026.3.7',
  gatewayPort: 18789,
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  verbosity:          'normal',
  advisorPersistence: 'per_task',
};
