/**
 * RetrievalPlan — instructions produced by RetrievalPlanBuilder for the
 * retrieval layer.  The retrieval layer must NOT perform any linguistic
 * analysis; it only executes the plan as given.
 */
export interface RetrievalPlan {
  /**
   * Ordered list of search terms to pass to the retrieval backend.
   * Noise and Unknown tokens are excluded; sorted by descending weight.
   */
  searchTerms: string[];
  /**
   * Retrieval strategies to attempt (e.g. 'keyword', 'vector', 'graph').
   * Phase 1 / V1 uses ['keyword'] only.
   */
  strategies: string[];
  /** Maximum number of results to return across all strategies */
  maxResults: number;
  /**
   * ISO language tag derived from the original query (e.g. 'zh-TW', 'en').
   * Must not be empty.
   */
  language: string;
}
