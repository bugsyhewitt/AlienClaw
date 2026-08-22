import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { PATHS } from '../constants.js';
import { DEFAULT_CONFIG, DEFAULT_PREFERENCES } from './defaults.js';
import type { AlienClawConfig, UserPreferences } from '../types.js';
import { atomicWrite } from '../utils.js';

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });  // idempotent — no pre-check needed
}

function loadOrCreate<T>(path: string, defaults: T): T {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    ensureDir(path);
    writeFileSync(path, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (syntaxErr) {
    // PKT-088 / R-301 — malformed JSON re-thrown with file-path context.
    throw new Error(`Malformed JSON at ${path}: ${(syntaxErr as Error).message}`);
  }
  // PKT-652 — non-object JSON is a silent corruption vector.
  // {..."hi"} → {0:"h",1:"i",...} poisons the singleton with character-index keys.
  // Return defaults and warn so the user notices the bad file.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const kind = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    process.stderr.write(
      `[AlienClaw] WARNING: ${path} contains valid JSON but not an object (got ${kind}). ` +
      `Falling back to defaults; please repair or delete ${path}.\n`,
    );
    return defaults;
  }
  return { ...defaults, ...parsed as Partial<T> };
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
    atomicWrite(PATHS.preferences, JSON.stringify(updated, null, 2));
  }
}

export const alienClawConfig = new AlienClawConfigManager();
