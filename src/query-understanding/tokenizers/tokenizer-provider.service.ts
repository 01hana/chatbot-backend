import { Injectable, Logger } from '@nestjs/common';
import { ITokenizer } from './tokenizer.interface.js';
import { RuleBasedTokenizerAdapter } from './rule-based.tokenizer.js';
import { EnglishTokenizer } from './english.tokenizer.js';
import { JiebaTokenizer } from './jieba.tokenizer.js';
import { SystemConfigService } from '../../system-config/system-config.service.js';

/**
 * TokenizerProviderService — resolves the correct ITokenizer for a request.
 *
 * Phase 2 selection matrix (T034):
 *   language='en'
 *     → EnglishTokenizer
 *
 *   language != 'en', feature.zh_tokenizer='jieba', JiebaTokenizer.isReady()
 *     → JiebaTokenizer
 *
 *   language != 'en', feature.zh_tokenizer='jieba', !JiebaTokenizer.isReady()
 *     → RuleBasedTokenizerAdapter  (WARN)
 *
 *   language != 'en', feature.zh_tokenizer='rule-based'
 *     → RuleBasedTokenizerAdapter
 *
 *   language != 'en', unknown feature value
 *     → RuleBasedTokenizerAdapter  (WARN)
 *
 *   SystemConfigService read error (any)
 *     → RuleBasedTokenizerAdapter  (WARN)
 *
 * Never throws.
 */
@Injectable()
export class TokenizerProviderService {
  private readonly logger = new Logger(TokenizerProviderService.name);

  private readonly ruleBasedTokenizer = new RuleBasedTokenizerAdapter();
  private readonly englishTokenizer = new EnglishTokenizer();

  /**
   * The name of the tokenizer most recently returned by `getTokenizer()`.
   * Used to populate `QueryUnderstandingResult.tokenizer`.
   */
  private lastUsedName = 'rule-based';

  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly jiebaTokenizer: JiebaTokenizer,
  ) {}

  /**
   * Return the appropriate ITokenizer for the given language.
   *
   * @param language  ISO language tag, e.g. 'zh-TW' | 'en'.
   * @returns         A resolved ITokenizer instance; never throws.
   */
  getTokenizer(language: string): ITokenizer {
    try {
      // ── English ─────────────────────────────────────────────────────────
      if (language === 'en') {
        this.lastUsedName = 'english';
        return this.englishTokenizer;
      }

      // ── Non-English: check feature flag ──────────────────────────────────
      const zhTokenizer = this.systemConfigService.getString(
        'feature.zh_tokenizer',
        'rule-based',
      );

      if (zhTokenizer === 'jieba') {
        if (this.jiebaTokenizer.isReady()) {
          this.lastUsedName = 'jieba';
          return this.jiebaTokenizer;
        }
        this.logger.warn(
          'TokenizerProviderService: JiebaTokenizer not ready, ' +
            'falling back to RuleBasedTokenizer',
        );
        this.lastUsedName = 'rule-based';
        return this.ruleBasedTokenizer;
      }

      if (zhTokenizer !== 'rule-based') {
        this.logger.warn(
          `TokenizerProviderService: unknown feature.zh_tokenizer value ` +
            `"${zhTokenizer}", falling back to RuleBasedTokenizer`,
        );
      }

      this.lastUsedName = 'rule-based';
      return this.ruleBasedTokenizer;
    } catch (err) {
      this.logger.warn(
        `TokenizerProviderService: error selecting tokenizer (${String(err)}), ` +
          'falling back to RuleBasedTokenizer',
      );
      this.lastUsedName = 'rule-based';
      return this.ruleBasedTokenizer;
    }
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
