import { ChunkResult } from '../types/chunk-result.type.js';
import { RetrievalPlan } from '../../query-understanding/types/retrieval-plan.type.js';

/** DI injection token for the graph retriever. */
export const GRAPH_RETRIEVER = Symbol('GRAPH_RETRIEVER');

/**
 * IGraphRetriever — interface for graph-based (sparse) retrieval.
 *
 * V1: only a stub implementation exists (returns []).
 * Future phases may connect to a graph store for entity/relation traversal.
 * Implementations MUST NOT perform tokenisation, linguistic analysis, or
 * domain-signal logic — that is handled upstream by QueryUnderstandingService.
 * No Neo4j, no multi-hop traversal, no complete GraphRAG in V1.
 */
export interface IGraphRetriever {
  /**
   * Retrieve results using graph traversal.
   *
   * @param plan   RetrievalPlan produced by QueryUnderstandingService.
   * @param limit  Maximum number of results to return.
   * @returns      Ordered array of ChunkResult (highest score first).
   */
  retrieve(plan: RetrievalPlan, limit: number): Promise<ChunkResult[]>;
}
