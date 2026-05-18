/**
 * ChunkTraceDetail — per-chunk retrieval metadata recorded for traceability.
 *
 * `retriever` values in V1: 'keyword' | 'legacy' | 'unknown'.
 * Vector and Graph retrievers are stubs in Phase 3; their values will be filled
 * in when real implementations are added.
 */
export interface ChunkTraceDetail {
  /** Chunk-level identifier (undefined for legacy KnowledgeEntry-based results). */
  chunkId?: string;
  /** KnowledgeEntry row ID (undefined for pure chunk-based results). */
  knowledgeEntryId?: number;
  /** Retrieval score (0–1) assigned by the retriever or reranker. */
  score: number;
  /** Name of the retriever that surfaced this result (e.g. 'keyword', 'legacy'). */
  retriever: string;
  /** Dominant token type associated with this result, if known. */
  tokenType?: string;
}

/**
 * AnswerTrace — wall-clock timing breakdown for a single pipeline turn.
 *
 * Populated only when `feature.traceable_answer_enabled=true`.
 * All `*Ms` fields are integer milliseconds from `Date.now()` deltas.
 */
export interface AnswerTrace {
  /** Time spent in QueryUnderstandingService.understand() (ms). */
  queryUnderstandingMs: number;
  /** Time spent in retrieval (KeywordRetriever / legacy retrieval) (ms). */
  retrievalMs: number;
  /** Time spent in FusionService + RerankerService (ms). */
  fusionMs: number;
  /** Time spent waiting for the LLM response (ms). Absent when LLM not called. */
  llmMs?: number;
  /** Total pipeline duration for this turn (ms). */
  totalMs: number;
  /** Per-chunk retrieval details for debugging. */
  chunkDetails?: ChunkTraceDetail[];
}
