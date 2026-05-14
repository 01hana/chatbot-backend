import { QueryToken } from '../types/query-token.type.js';

/**
 * ITokenizer — contract for all tokenizer implementations.
 *
 * Phase 1: RuleBasedTokenizer (wraps 002 RuleBasedQueryAnalyzer)
 * Phase 2: JiebaTokenizer, EnglishTokenizer
 *
 * Implementations must be stateless per call.  Any per-instance state
 * (e.g. Jieba readiness) must not affect the return type contract.
 */
export interface ITokenizer {
  /**
   * Tokenise the given text and return classified tokens.
   *
   * @param text      The (already-normalised) query text.
   * @param language  ISO language tag: 'zh-TW' | 'en'.
   * @returns         A Promise resolving to an array of QueryToken.
   *                  Must never reject; return [] on unrecoverable error.
   */
  tokenize(text: string, language: string): Promise<QueryToken[]>;
}

/** NestJS DI injection token for ITokenizer */
export const TOKENIZER = Symbol('TOKENIZER');
