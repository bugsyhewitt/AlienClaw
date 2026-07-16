/**
 * Graph evolution module barrel (P14-02).
 *
 * `isValidPartition` and `ExecutionTrace` exist in two modules with different
 * shapes (the graph-validator returns GraphValidationResult; assembly returns
 * a lightweight {ok, violation}). To keep the barrel unambiguous we re-export
 * the canonical graph-validator versions by name and alias the assembly ones.
 *
 * NAMING (AGENTS.md wall): "Subagent", never "Subagent".
 */
export * from "./types.js";
export * from "./graph-validator.js";
export * from "./operators.js";
export * from "./subagent-adapter.js";
export * from "./topology-adapter.js";
export * from "./config.js";
export * from "./feature-flag.js";
export * from "./coevolution.js";
export * from "./validate-hook.js";
export * from "./shadow-report.js";

// assembly.ts re-exported explicitly to resolve name collisions with
// graph-validator (isValidPartition) and types (ExecutionTrace).
export {
  resolveToStructures,
  assembleCampaignGraph,
  structureCost,
  makeSubagentGenomeId,
  makeTopologyGenomeId,
  isValidPartition as isValidPartitionLite,
  type ExecutionTrace as AssemblyExecutionTrace,
} from "./assembly.js";
