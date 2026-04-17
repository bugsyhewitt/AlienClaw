/**
 * ms-types.ts
 * Shared types for .ms Martian files and the registry.
 */

export type MartianStatus = 'active' | 'retired' | 'graveyard';

export interface GraveyardEntry {
  fitnessScore: number;   // 0.0 – 1.0
  generation:   number;
  genome:        string;   // 256-char Base62
}

export interface MartianSpec {
  /** e.g. "MS_WEB00001" */
  id:          string;
  description: string;
  generation:  number;
  status:      MartianStatus;
  fitness:     number;   // 0.0 – 1.0

  /** Tool names listed in [TOOLS] section (e.g. "web_search") */
  tools:       string[];

  /** .msb filenames referenced in [TOOLS] section (e.g. "web_search.msb") */
  msbRefs:     string[];

  /** Tags derived from tools — used by Employee for selection */
  toolTags:    string[];

  /** Raw 256-char Base62 genome string */
  genome:      string;

  graveyard:   GraveyardEntry[];
}

export interface MartianExecutionInput {
  martian:    MartianSpec;
  task:        string;
  context:     Record<string, unknown>;
}

export type MartianOutcome = 'SUCCESS' | 'FAILURE' | 'ESCALATED';

export interface MartianExecutionResult {
  outcome:     MartianOutcome;
  output:      unknown;
  error?:      string;
  failForward: boolean;
}
