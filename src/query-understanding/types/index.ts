/**
 * src/query-understanding/types/index.ts
 *
 * Barrel export for Query Understanding V2 types.
 * Phase 1 (T012–T016) exports.
 */
export { TokenType } from './token-type.enum.js';
export { QueryType } from './query-type.enum.js';
export type { QueryToken } from './query-token.type.js';
export type { RetrievalPlan } from './retrieval-plan.type.js';
export type { SupportabilityStatus } from './query-understanding-result.type.js';
export type {
  QueryUnderstandingResult,
  QueryDebugMeta,
} from './query-understanding-result.type.js';
