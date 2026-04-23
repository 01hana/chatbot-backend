/**
 * ITokenizer — interface for splitting a text string into token arrays.
 *
 * Tokenization is language-aware: Chinese text is split by character / word
 * boundary heuristics, while English text is split on whitespace. The default
 * implementation is RuleBasedTokenizer (QA-002); future implementations may
 * use segmentation libraries (e.g. jieba-wasm for zh-TW).
 *
 * DI token: TOKENIZER
 */
export interface ITokenizer {
  /**
   * Split a normalised text string into an array of raw tokens.
   *
   * @param text     Normalised (post-question-shell-removal) input text.
   * @param language Language code: 'zh-TW' | 'en'.
   * @returns        Array of token strings; never returns null.
   */
  tokenize(text: string, language: string): string[];
}

/** NestJS DI token for ITokenizer. */
export const TOKENIZER = Symbol('TOKENIZER');
