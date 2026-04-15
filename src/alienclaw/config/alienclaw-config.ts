import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { PATHS } from '../constants.js';
import { DEFAULT_CONFIG, DEFAULT_PREFERENCES } from './defaults.js';
import type { AlienClawConfig, UserPreferences } from '../types.js';

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });  // idempotent — no pre-check needed
}

function loadOrCreate<T>(path: string, defaults: T): T {
  try {
    return { ...defaults, ...JSON.parse(readFileSync(path, 'utf-8')) as T };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    ensureDir(path);
    writeFileSync(path, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }
}

export class AlienClawConfigManager {
  readonly system:      AlienClawConfig;
  readonly preferences: UserPreferences;

  constructor() {
    this.system      = loadOrCreate(PATHS.config,      DEFAULT_CONFIG);
    this.preferences = loadOrCreate(PATHS.preferences, DEFAULT_PREFERENCES);
  }

  savePreferences(prefs: Partial<UserPreferences>): void {
    const updated = { ...this.preferences, ...prefs };
    writeFileSync(PATHS.preferences, JSON.stringify(updated, null, 2), 'utf-8');
  }
}

export const alienClawConfig = new AlienClawConfigManager();
