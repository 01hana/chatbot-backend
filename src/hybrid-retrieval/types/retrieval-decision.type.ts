import { ChunkResult } from './chunk-result.type.js';

/**
 * Reason codes produced by RetrievalDecisionService.
 *
 * - ok              — retrieval succeeded; pipeline may call LLM / template
 * - no_results      — retriever returned zero hits
 * - low_score       — all hits scored below the minimum threshold
 * - unsupported     — QueryUnderstandingService marked the query as unsupported
 * - all_tokens_noise — every query token was classified as Noise
 * - unknown_query_type — queryType could not be determined
 */
export type RetrievalDecisionReason =
  | 'ok'
  | 'no_results'
  | 'low_score'
  | 'unsupported'
  | 'all_tokens_noise'
  | 'unknown_query_type';

/**
 * RetrievalDecision — gate decision produced by RetrievalDecisionService
 * (T049).  Consumed by ChatPipelineService Step 6.5 to decide whether to
 * allow the LLM call or emit a fallback SSE response.
 */
export interface RetrievalDecision {
  /** Whether the pipeline should proceed to answer generation. */
  canAnswer: boolean;
  /** Machine-readable reason code explaining the decision. */
  reason: RetrievalDecisionReason;
  /** Confidence in the decision, in [0, 1]. */
  confidence: number;
  /** Top-K results to pass to the answer-generation step. */
  topK: ChunkResult[];
}
