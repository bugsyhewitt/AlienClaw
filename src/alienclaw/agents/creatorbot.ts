import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AGENT_MODELS, PATHS, GENOME_LENGTH } from '../constants.js';
import type { EmployeeSpec, CreatorQueueItem, CreatorQueuePriority } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_PATH  = join(__dirname, '..', 'prompts', 'creatorbot.soul.md');

export class CreatorBot {
  readonly name  = 'CreatorBot' as const;
  readonly model = AGENT_MODELS.CreatorBot;
  readonly soul  = readFileSync(SOUL_PATH, 'utf-8');

  private queue: CreatorQueueItem[] = [];

  systemPrompt(): string {
    return this.soul;
  }

  // ── Queue ──────────────────────────────────────────────────────────────────

  enqueue(priority: CreatorQueuePriority, observation: string, context: string): void {
    this.queue.push({ priority, observation, context, ts: Date.now() });
  }

  flushNotable(): CreatorQueueItem[] {
    const notable = this.queue.filter(i => i.priority === 'NOTABLE');
    this.queue    = this.queue.filter(i => i.priority !== 'NOTABLE');
    return notable;
  }

  peekUrgent(): CreatorQueueItem | undefined {
    return this.queue.find(i => i.priority === 'URGENT');
  }

  consumeUrgent(): CreatorQueueItem | undefined {
    const idx = this.queue.findIndex(i => i.priority === 'URGENT');
    if (idx === -1) return undefined;
    return this.queue.splice(idx, 1)[0];
  }

  // ── Genome ─────────────────────────────────────────────────────────────────

  validateGenome(genome: string): { valid: boolean; reason?: string } {
    if (genome.length !== GENOME_LENGTH)
      return { valid: false, reason: `Length ${genome.length} ≠ 256` };
    if (!/^[0-9A-Za-z]+$/.test(genome))
      return { valid: false, reason: 'Non-Base62 characters found' };
    return { valid: true };
  }

  writeMs(msId: string, content: string): void {
    if (!existsSync(PATHS.ms)) mkdirSync(PATHS.ms, { recursive: true });
    writeFileSync(join(PATHS.ms, `${msId}.ms`), content, 'utf-8');
  }

  // ── Employee spec ──────────────────────────────────────────────────────────

  buildEmployeeSpec(
    domain: string,
    toolTags: string[],
    model: string,
    generation = 1,
    failureContext?: string   // what failed on previous attempts
  ): EmployeeSpec {
    const suffix     = Date.now().toString(36).toUpperCase();
    const employeeId = `EMP_${domain.toUpperCase().slice(0, 6)}_${suffix}`;
    // failureContext is passed to CreatorBot's LLM call in Phase 2B.
    // Stored here for forward compatibility.
    void failureContext;
    return {
      employeeId,
      domain,
      model,
      toolTags,
      createdBy:  'CreatorBot',
      createdAt:  Date.now(),
      generation,
    };
  }
}

export const creatorBot = new CreatorBot();
