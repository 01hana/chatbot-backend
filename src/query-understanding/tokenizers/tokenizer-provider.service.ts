import { Injectable } from '@nestjs/common';
import { ITokenizer } from './tokenizer.interface.js';
import { RuleBasedTokenizerAdapter } from './rule-based.tokenizer.js';

/**
 * TokenizerProviderService — resolves the correct ITokenizer for a request.
 *
 * Phase 1 (T024):
 *   All languages, including 'en', are served by RuleBasedTokenizerAdapter.
 *   Jieba and EnglishTokenizer paths are left empty and will be wired in
 *   Phase 2 (T034) once those tokenizers are implemented.
 *
 * Phase 2 design (preview — NOT yet implemented):
 *   - 'en'                                              → EnglishTokenizer
 *   - feature.zh_tokenizer='jieba' + Jieba.isReady()   → JiebaTokenizer
 *   - feature.zh_tokenizer='jieba' + !Jieba.isReady()  → RuleBasedTokenizerAdapter (WARN)
 *   - feature.zh_tokenizer='rule-based'                → RuleBasedTokenizerAdapter
 *
 * Never throws; falls back to RuleBasedTokenizerAdapter on any unexpected state.
 */
@Injectable()
export class TokenizerProviderService {
  private readonly ruleBasedTokenizer = new RuleBasedTokenizerAdapter();

  /**
   * The name of the tokenizer most recently returned by `getTokenizer()`.
   * Used to populate `QueryUnderstandingResult.tokenizer`.
   */
  private lastUsedName = 'rule-based';

  /**
   * Return the appropriate ITokenizer for the given language.
   *
   * Phase 1: always returns RuleBasedTokenizerAdapter.
   *
   * @param language  ISO language tag, e.g. 'zh-TW' | 'en'.
   * @returns         A resolved ITokenizer instance; never throws.
   */
  getTokenizer(_language: string): ITokenizer {
    // Phase 1: single tokenizer for all languages.
    // Phase 2 (T034) will branch on language and feature flag.
    this.lastUsedName = 'rule-based';
    return this.ruleBasedTokenizer;
  }

  /**
   * Return the name of the tokenizer last returned by `getTokenizer()`.
   *
   * Used to populate `QueryUnderstandingResult.tokenizer` for debugging and
   * audit purposes.
   */
  getLastUsedName(): string {
    return this.lastUsedName;
  }
}
