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
  /**
   * Preferred language for retrieval (e.g. "zh-TW" | "en").
   * When set, same-language entries are queried first;
   * only falls back to cross-language if nothing is found.
   */
  language?: string;
  /** Maximum number of results to return (default 5). */
  limit?: number;
  /**
   * Ranking profile key to use for scoring weights (e.g. 'default' | 'faq' | 'product' | 'diagnosis').
   * Populated by ChatPipelineService when QueryAnalysis is enabled (QA-005).
   * The retrieval service may use this to select a scoring profile from SystemConfig.
   */
  rankingProfile?: string;
  /**
   * Expanded term list from GlossaryExpansionProvider (synonyms + original terms).
   * Populated by ChatPipelineService when QueryAnalysis is enabled (QA-005).
   * Can be used for app-layer reranking instead of re-extracting via QueryNormalizer.
   */
  expandedTerms?: string[];
}

/**
 * A single retrieval result including the knowledge entry and its score.
 */
export interface RetrievalResult {
  entry: KnowledgeEntry;
  /** Similarity score in [0, 1]. Higher = more similar. */
  score: number;
  /**
   * True when this result was returned by the cross-language fallback path
   * (no same-language entries matched the query).
   */
  isCrossLanguageFallback?: boolean;
}
