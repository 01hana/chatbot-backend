import { TokenType } from './token-type.enum.js';

/**
 * QueryToken — a single classified token produced by an ITokenizer.
 */
export interface QueryToken {
  /** Original token text as extracted from the query */
  text: string;
  /** Normalised form (full-width → half-width, lowercased for 'en') */
  normalizedText: string;
  /** Semantic classification of this token */
  tokenType: TokenType;
  /**
   * Relevance weight in [0, 1].
   * Tokens with weight ≥ 0.7 are eligible as keyPhrases.
   */
  weight: number;
  /**
   * Which tokenizer/source produced this token.
   * Used for debugging and traceability.
   */
  source: 'jieba' | 'rule-based' | 'english' | 'dictionary' | 'glossary' | 'classifier';
}
