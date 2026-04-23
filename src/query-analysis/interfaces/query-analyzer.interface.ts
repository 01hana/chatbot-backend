import { AnalyzedQuery } from '../types/analyzed-query.type';

/**
 * IQueryAnalyzer — core interface for the query analysis pipeline.
 *
 * Implementations receive a raw user query string and produce a structured
 * AnalyzedQuery. The default implementation is RuleBasedQueryAnalyzer
 * (QA-002); additional implementations (e.g. ML-based) can be swapped in
 * without changing callers.
 *
 * DI token: QUERY_ANALYZER
 */
export interface IQueryAnalyzer {
  /**
   * Analyse a raw user query and return a structured AnalyzedQuery.
   *
   * @param raw      Raw, untrimmed user input string.
   * @param language Optional language hint ('zh-TW' | 'en').
   *                 When omitted, the analyzer auto-detects the language.
   */
  analyze(raw: string, language?: string): Promise<AnalyzedQuery>;
}

/** NestJS DI token for IQueryAnalyzer. */
export const QUERY_ANALYZER = Symbol('QUERY_ANALYZER');
