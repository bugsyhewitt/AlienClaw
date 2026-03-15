/**
 * src/alienclaw/index.ts
 * Main barrel for the AlienClaw agent hierarchy.
 */

// Core
export * from './constants.js';
export * from './types.js';

// Agents
export { bossBot }         from './agents/bossbot.js';
export { advisorBot }      from './agents/advisorbot.js';
export { creatorBot }      from './agents/creatorbot.js';
export { agentRegistry }   from './agents/agent-registry.js';
export {
  Employee,
  buildEmployee,
  registerEmployee,
  deregisterEmployee,
  getEmployee,
  getAllEmployees,
} from './agents/employee.js';

// Config
export { alienClawConfig } from './config/alienclaw-config.js';

// Governance (Phase 2B)
export { GovernanceLoop }    from './governance/governance-loop.js';
export { GoalManager }       from './governance/goal-manager.js';
export { TaskManager }       from './governance/task-manager.js';
export { EscalationHandler } from './governance/escalation-handler.js';
export { CompletionHandler } from './governance/completion-handler.js';
export { UserChannel }       from './comms/user-channel.js';
export { bootstrap }         from './wiring/hierarchy-bootstrap.js';

// Registry (Phase 3)
// Selective exports to avoid name clashes with constants.ts
// (genome-codec re-exports GENOME_LENGTH, BLOCK_SIZE, etc.)
export {
  validateGenome,
  assembleGenome,
  parseGenome,
  computeChecksum,
  BASE62_ALPHABET,
  BLOCK,
} from './registry/genome-codec.js';
export type { GenomeBlocks, GenomeValidationResult, BlockIndex } from './registry/genome-codec.js';
export type { MeeseeksSpec, MeeseeksStatus, GraveyardEntry,
              MeeseeksExecutionInput, MeeseeksExecutionResult, MeeseeksOutcome } from './registry/ms-types.js';
export { loadMsFile, loadMsDirectory, MsParseError }       from './registry/ms-loader.js';
export { MeeseeksRegistry, RegistryError }                  from './registry/meeseeks-registry.js';
export { installSeeds }                                     from './registry/seed-installer.js';
export { getRegistry }                                      from './registry/registry.js';

// MeeseeksBrain / executor (Phase 3)
export * from './msb/index.js';
