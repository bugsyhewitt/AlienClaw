/**
 * Specialist — ephemeral campaign-scoped subagent (Packet 7).
 *
 * A Specialist is spawned by CreatorBot for a single campaign. It:
 * 1. Holds a randomly-generated valid genome
 * 2. Summons one or more Martians via the shared summon adapter
 * 3. Reports results back, then is discarded (erase() removes state)
 *
 * Specialists are NOT Tier-A agents — they have no persistent workspace,
 * no identity in the comm graph, and cannot initiate communication.
 */

import type { MartianSummonAdapter, MartianSummonResult } from './summon-adapter.js';
import { randomGenome } from './random-genome.js';
import { randomUUID } from 'node:crypto';

export interface SpecialistOptions {
  /** Campaign ID this Specialist belongs to. */
  campaignId:       string;
  /** Martian type to summon (must be in brain registry). */
  martianType:      string;
  /** Inputs forwarded to the Martian. */
  inputs:           Record<string, unknown>;
  /** Timeout in ms. */
  timeoutMs:        number;
  /** Override genome (for deterministic tests). Ignored when fromPopulation=true. */
  genome?:          string;
  /**
   * When true, the RealMartianSummonAdapter sends kind='summon-from-population'
   * and the Python bridge selects a genome via tournament selection from the
   * population for this martian_type. The genome used is returned in the response.
   * Defaults to false (use locally-generated random genome) for backward compat.
   */
  fromPopulation?:  boolean;
}

export interface SpecialistReport {
  specialistId: string;
  campaignId:   string;
  genome:       string;
  martianType:  string;
  result:       MartianSummonResult;
}

export class Specialist {
  readonly specialistId: string;
  readonly genome:       string;
  private _erased = false;

  constructor(
    private readonly adapter: MartianSummonAdapter,
    private readonly opts:    SpecialistOptions,
  ) {
    this.specialistId = randomUUID();
    this.genome       = opts.genome ?? randomGenome('SPEC0001');
  }

  /** Execute the Martian summon and return a report. */
  async execute(): Promise<SpecialistReport> {
    if (this._erased) throw new Error(`Specialist ${this.specialistId} has been erased`);

    const result = await this.adapter.summon({
      summon_id:      this.specialistId,
      genome:         this.genome,
      martian_type:   this.opts.martianType,
      inputs:         this.opts.inputs,
      timeout_ms:     this.opts.timeoutMs,
      fromPopulation: this.opts.fromPopulation,
    });

    return {
      specialistId: this.specialistId,
      campaignId:   this.opts.campaignId,
      genome:       this.genome,
      martianType:  this.opts.martianType,
      result,
    };
  }

  /** Erase ephemeral state — called by CreatorBot after campaign completes. */
  erase(): void {
    this._erased = true;
  }

  get isErased(): boolean { return this._erased; }
}
