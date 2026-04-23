/**
 * IQueryRuleProvider — interface for fetching query processing rules from
 * the database (stop words, noise words, question-shell patterns).
 *
 * Implementations must cache results in-memory and expose an invalidation
 * method so that admin-side mutations take effect without a server restart.
 *
 * The default implementation is DbQueryRuleProvider (QA-003), which reads
 * from the `query_rules` table. A fallback to QueryNormalizer hardcoded
 * patterns applies when the DB has no data.
 *
 * DI token: QUERY_RULE_PROVIDER
 */
export interface IQueryRuleProvider {
  /**
   * Return the set of stop words for the given language.
   * Stop words are removed during query normalisation.
   *
   * @param language Language code: 'zh-TW' | 'en'.
   */
  getStopWords(language: string): Promise<Set<string>>;

  /**
   * Return the set of noise words for the given language.
   * Noise words are removed during token filtering (after tokenisation).
   *
   * @param language Language code: 'zh-TW' | 'en'.
   */
  getNoiseWords(language: string): Promise<Set<string>>;

  /**
   * Return compiled regex patterns for question-shell removal.
   * These replace the hardcoded patterns in QueryNormalizer.
   *
   * @param language Language code: 'zh-TW' | 'en'.
   */
  getQuestionShellPatterns(language: string): Promise<RegExp[]>;

  /**
   * Invalidate the in-memory rule cache.
   * The next call to any getter will re-fetch from the database.
   * Called by the admin system-config mutation endpoint.
   */
  invalidateCache(): void;
}

/** NestJS DI token for IQueryRuleProvider. */
export const QUERY_RULE_PROVIDER = Symbol('QUERY_RULE_PROVIDER');
