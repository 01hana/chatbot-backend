import { ChunkResult } from '../types/chunk-result.type.js';
import { RetrievalPlan } from '../../query-understanding/types/retrieval-plan.type.js';

/** DI injection token for the vector retriever. */
export const VECTOR_RETRIEVER = Symbol('VECTOR_RETRIEVER');

/**
 * IVectorRetriever — interface for embedding-based (dense) retrieval.
 *
 * V1: only a stub implementation exists (returns []).
 * Future phases may connect to pgvector or a dedicated embedding service.
 * Implementations MUST NOT perform tokenisation, linguistic analysis, or
 * domain-signal logic — that is handled upstream by QueryUnderstandingService.
 */
export interface IVectorRetriever {
  /**
   * Retrieve results using vector/embedding similarity.
   *
   * @param plan   RetrievalPlan produced by QueryUnderstandingService.
   * @param limit  Maximum number of results to return.
   * @returns      Ordered array of ChunkResult (highest score first).
   */
  retrieve(plan: RetrievalPlan, limit: number): Promise<ChunkResult[]>;
}
