/**
 * Public exports for the src/alienclaw/governance/ module (Packet 6 layer).
 *
 * NOTE: This is the simplified governance layer added in Packet 6.
 * The existing src/alienclaw/governance/*.ts files (governance-loop.ts,
 * goal-manager.ts, etc.) are a separate, more complex production system.
 * This index exports only the Packet 6 additions.
 */

export * from './messages.js';
export * from './comm-graph.js';
export * from './logger.js';
export * from './summon-adapter.js';
export { AdvisorBot } from './advisor-bot.js';
export { CreatorBot } from './creator-bot.js';
export { BossBot } from './boss-bot.js';
export { GoalLoop } from './goal-loop.js';
export type { GoalLoopDeps } from './goal-loop.js';
