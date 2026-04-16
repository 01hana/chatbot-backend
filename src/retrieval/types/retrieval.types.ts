import { KnowledgeEntry } from '../../generated/prisma/client';

/**
 * Input to IRetrievalService.retrieve().
 */
export interface RetrievalQuery {
  /** Free-text user message used for similarity matching. */
  query: string;
  /** Optional intent label to narrow the result set. */
  intentLabel?: string;
  /** Optional tag filter — entry must contain ALL listed tags. */
  tags?: string[];
  /** Maximum number of results to return (default 5). */
  limit?: number;
}

/**
 * A single retrieval result including the knowledge entry and its score.
 */
export interface RetrievalResult {
  entry: KnowledgeEntry;
  /** Similarity score in [0, 1]. Higher = more similar. */
  score: number;
}
