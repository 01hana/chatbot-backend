/**
 * IQueryExpansionProvider — interface for glossary-based term expansion.
 *
 * Receives a list of extracted terms and returns an expanded list that
 * includes the original terms plus any synonyms found in the GlossaryTerm
 * cache. The expanded list is stored in AnalyzedQuery.expandedTerms and
 * passed to RetrievalService for multi-term reranking.
 *
 * The default implementation is GlossaryExpansionProvider (QA-004), which
 * reads from the IntentService in-memory glossary cache (no direct DB access).
 *
 * DI token: QUERY_EXPANSION_PROVIDER
 */
export interface IQueryExpansionProvider {
  /**
   * Expand a list of terms using the glossary synonym index.
   *
   * The returned array always includes the original terms; duplicates are
   * deduplicated. Order is not guaranteed.
   *
   * @param terms    List of extracted terms from the current query.
   * @param language Language code: 'zh-TW' | 'en'.
   * @returns        Expanded term list (original + synonyms), deduplicated.
   */
  expand(terms: string[], language: string): Promise<string[]>;
}

/** NestJS DI token for IQueryExpansionProvider. */
export const QUERY_EXPANSION_PROVIDER = Symbol('QUERY_EXPANSION_PROVIDER');
