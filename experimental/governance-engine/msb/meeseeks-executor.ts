/**
 * DEPRECATED: Use './martian-executor.js' instead.
 * This file is maintained for backward compatibility.
 */
export {
  executeMartian as executeMeeseeks,
  registerToolAdapter,
  getToolAdapter,
  type ToolFn,
  type ToolResolver,
  type ExecutionContext,
  type MartianSpec as MeeseeksSpec,
} from './martian-executor.js';
