import { IQueryAnalyzer } from '../interfaces/query-analyzer.interface';
import { IQueryExpansionProvider } from '../interfaces/query-expansion-provider.interface';
import type { IQueryRuleProvider } from '../interfaces/query-rule-provider.interface';
import { AnalyzedQuery } from '../types/analyzed-query.type';
import { RuleBasedTokenizer } from '../tokenizers/rule-based-tokenizer';

/**
 * RuleBasedQueryAnalyzer — default IQueryAnalyzer implementation.
 *
 * Implements the 10-step pipeline defined in design.md §4.4.
 *
 * Rules (stop words, question-shell patterns) are read from IQueryRuleProvider
 * when injected (QA-003+), and fall back to the hardcoded constants below when
 * no provider is supplied or when the DB returns empty results.
 *
 * Glossary expansion (Step 8) delegates to IQueryExpansionProvider. When no
 * provider is supplied a no-op stub is used. QA-004 wires in
 * GlossaryExpansionProvider.
 */
export class RuleBasedQueryAnalyzer implements IQueryAnalyzer {
  private readonly tokenizer = new RuleBasedTokenizer();

  constructor(
    private readonly ruleProvider?: IQueryRuleProvider,
    private readonly expansionProvider?: IQueryExpansionProvider,
  ) {}

  // ── Step patterns (mirrored from QueryNormalizer for 100 % backward compat) ─

  private static readonly ZH_LEADING =
    /^(請問(?:一下)?|想問(?:一下)?|我想問|請幫我|幫我查|查一下|告訴我|想知道|麻煩你|請告訴我|我想了解|能告訴我)[，,\s]*/u;

  private static readonly ZH_QUESTION_VERBS =
    /^(如何|怎麼|怎樣|可以|有沒有辦法|能否)/u;

  private static readonly ZH_TRAILING_PARTICLES =
    /\s*(有哪些|有哪幾種|有什麼|是什麼|怎麼樣|可以嗎|嗎|呢|啊|喔|好嗎)[？?！!。.…]*$/u;

  private static readonly EN_LEADING =
    /^(how\s+(?:can|do|could|would|should)\s+(?:i|we|you|one)\s+|how\s+to\s+|what\s+(?:are\s+the\s+|is\s+the\s+|types\s+of\s+|kind\s+of\s+)?|what\s+|where\s+can\s+(?:i|we)\s+|where\s+do\s+(?:i|we)\s+|can\s+(?:i|we|you)\s+|is\s+there\s+(?:a\s+way\s+to\s+)?|do\s+you\s+(?:have\s+|offer\s+|provide\s+)?|please\s+(?:tell\s+me\s+(?:about\s+)?)?|could\s+you\s+(?:tell\s+me\s+(?:about\s+)?)?)/i;

  private static readonly EN_TRAILING =
    /\s*(do\s+you\s+(?:have|offer|provide|carry)|can\s+you\s+(?:tell\s+me)?)[?!.]*$/i;

  private static readonly FULL_WIDTH = /[\uff01-\uff5e]/g;
  private static readonly TRAILING_PUNCT = /[？?！!。.…,，]+$/u;
  private static readonly WHITESPACE = /\s+/g;

  private static readonly EN_STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
    'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
    'should', 'may', 'might', 'i', 'we', 'you', 'it', 'its', 'my',
    'your', 'our', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'from',
    'with', 'and', 'or', 'not', 'that', 'this', 'these', 'those',
  ]);

  /** Patterns used to detect a "question-shell" structure for profile selection. */
  private static readonly ZH_HAS_QUESTION_SHELL =
    /(請問|想問|告訴我|想知道|如何|怎麼|怎樣|有哪些|有哪幾種|是什麼|嗎|呢)/u;

  private static readonly EN_HAS_QUESTION_SHELL =
    /^(how|what|where|can|is|do|could|please)/i;

  // ── Public API ────────────────────────────────────────────────────────────

  async analyze(raw: string, language?: string): Promise<AnalyzedQuery> {
    const start = Date.now();
    const steps: string[] = [];

    if (!raw || !raw.trim()) {
      return this.emptyResult(raw ?? '', language ?? 'zh-TW', start);
    }

    // ── Step 1: Language detection ─────────────────────────────────────────
    const lang = language ?? RuleBasedQueryAnalyzer.detectLang(raw.trim());
    steps.push('lang-detect');

    // ── Step 2: Full-width → half-width normalisation ──────────────────────
    let q = raw.trim().replace(RuleBasedQueryAnalyzer.FULL_WIDTH, c =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );
    steps.push('full-width');

    // Snapshot: did the raw query have a question-shell before stripping?
    const hadQuestionShell = this.hasQuestionShell(raw.trim(), lang);

    // ── Step 3: Question-shell removal ─────────────────────────────────────
    const matchedRules: string[] = [];
    if (this.ruleProvider) {
      const patterns = await this.ruleProvider.getQuestionShellPatterns(lang);
      if (patterns.length > 0) {
        for (const pattern of patterns) {
          if (pattern.test(q)) {
            matchedRules.push('db-question-shell');
            q = q.replace(pattern, '').trim();
          }
        }
      } else {
        // DB returned empty — fall back to hardcoded
        q = this.applyHardcodedQuestionShell(q, lang, matchedRules);
      }
    } else {
      q = this.applyHardcodedQuestionShell(q, lang, matchedRules);
    }
    q = q.replace(RuleBasedQueryAnalyzer.TRAILING_PUNCT, '').trim();
    q = q.replace(RuleBasedQueryAnalyzer.WHITESPACE, ' ').trim();
    const normalizedQuery = q.length > 0 ? q : raw.trim();
    steps.push('question-shell');

    // ── Step 4: Stop words + noise words resolved for use in step 6 ──────────
    const stopWordsForLang: Set<string> = this.ruleProvider
      ? await this.ruleProvider.getStopWords(lang)
      : (lang === 'en' ? RuleBasedQueryAnalyzer.EN_STOP_WORDS : new Set<string>());
    const noiseWordsForLang: Set<string> = this.ruleProvider
      ? await this.ruleProvider.getNoiseWords(lang)
      : new Set<string>();
    steps.push('stop-words-deferred');

    // ── Step 4.5: Noise word string-level removal (zh-TW) ─────────────────
    // The CJK tokenizer emits individual characters, so compound noise words
    // (e.g. '一些', '相關') must be removed from the string *before* tokenisation.
    // This prevents their constituent characters from polluting the token stream.
    // For English, noise words are filtered token-by-token inside extractTerms().
    let tokenInput = normalizedQuery;
    if (lang !== 'en' && noiseWordsForLang.size > 0) {
      for (const word of noiseWordsForLang) {
        tokenInput = tokenInput.split(word).join('');
      }
      tokenInput = tokenInput.replace(RuleBasedQueryAnalyzer.WHITESPACE, ' ').trim()
        || normalizedQuery; // guard: never produce an empty tokenInput
    }
    steps.push('noise-word-filter');

    // ── Step 5: Tokenization ───────────────────────────────────────────────
    const tokens = this.tokenizer.tokenize(tokenInput, lang);
    steps.push('tokenize');

    // ── Step 6: Term extraction ────────────────────────────────────────────
    const terms = this.extractTerms(tokens, lang, stopWordsForLang, noiseWordsForLang);
    steps.push('term-extract');

    // ── Step 7: Phrase detection (bi-gram of adjacent terms) ──────────────
    const phrases = this.detectPhrases(terms, lang);
    steps.push('phrase-detect');

    // ── Step 8: Glossary expansion ─────────────────────────────────────────
    let expandedTerms: string[] = [...terms];
    let expansionHits = 0;
    if (this.expansionProvider) {
      const expanded = await this.expansionProvider.expand(terms, lang);
      expansionHits = expanded.filter(t => !terms.includes(t)).length;
      expandedTerms = [...new Set(expanded)];
    }
    steps.push('expansion');

    // ── Step 9: Profile selection ──────────────────────────────────────────
    const selectedProfile = this.selectProfile(raw.trim(), normalizedQuery, lang, hadQuestionShell);
    steps.push('profile-select');

    // ── Step 10: Assemble AnalyzedQuery ────────────────────────────────────
    return {
      rawQuery: raw,
      normalizedQuery,
      language: lang,
      tokens,
      terms,
      phrases,
      expandedTerms,
      matchedRules,
      selectedProfile,
      intentHints: [],   // populated by IG-005 (IntentService layer 1)
      debugMeta: {
        processingMs: Date.now() - start,
        normalizerSteps: steps,
        expansionHits,
      },
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Apply hardcoded question-shell removal patterns (fallback when no ruleProvider
   * or DB returned empty patterns).
   */
  private applyHardcodedQuestionShell(q: string, lang: string, matchedRules: string[]): string {
    if (lang === 'zh-TW') {
      if (RuleBasedQueryAnalyzer.ZH_LEADING.test(q)) {
        matchedRules.push('zh-leading');
        q = q.replace(RuleBasedQueryAnalyzer.ZH_LEADING, '').trim();
      }
      if (RuleBasedQueryAnalyzer.ZH_QUESTION_VERBS.test(q)) {
        matchedRules.push('zh-question-verbs');
        q = q.replace(RuleBasedQueryAnalyzer.ZH_QUESTION_VERBS, '').trim();
      }
      if (RuleBasedQueryAnalyzer.ZH_TRAILING_PARTICLES.test(q)) {
        matchedRules.push('zh-trailing-particles');
        q = q.replace(RuleBasedQueryAnalyzer.ZH_TRAILING_PARTICLES, '').trim();
      }
    } else if (lang === 'en') {
      if (RuleBasedQueryAnalyzer.EN_LEADING.test(q)) {
        matchedRules.push('en-leading');
        q = q.replace(RuleBasedQueryAnalyzer.EN_LEADING, '').trim();
      }
      if (RuleBasedQueryAnalyzer.EN_TRAILING.test(q)) {
        matchedRules.push('en-trailing');
        q = q.replace(RuleBasedQueryAnalyzer.EN_TRAILING, '').trim();
      }
    }
    return q;
  }

  /**
   * Extract high-confidence terms from the token list.
   *
   * - English: tokens with length ≥ 3 that are not in the stop-word set.
   * - Chinese: tokens with length ≥ 2 (single CJK chars are too ambiguous).
   *   ASCII tokens mixed with Chinese text (e.g. "M3") are kept regardless
   *   of length.
   */
  private extractTerms(
    tokens: string[],
    language: string,
    stopWords: Set<string>,
    noiseWords: Set<string>,
  ): string[] {
    if (language === 'en') {
      return tokens.filter(
        t => t.length >= 3 && !stopWords.has(t.toLowerCase()) && !noiseWords.has(t.toLowerCase()),
      );
    }

    // zh-TW
    return tokens.filter(token => {
      if (noiseWords.has(token)) return false;
      const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/u.test(token);
      const hasAlphaNum = /[A-Za-z0-9]/.test(token);
      if (hasCjk) return token.length >= 2;
      if (hasAlphaNum) return token.length >= 1; // keep "M3", "ISO", etc.
      return false;
    });
  }

  /**
   * Detect phrases via a bi-gram sliding window over the terms list.
   *
   * Adjacent terms are joined with a space (en) or no separator (zh-TW).
   * Only two-term phrases are produced (bi-grams). Longer n-grams are left
   * for QA-003+ when richer rule data is available.
   */
  private detectPhrases(terms: string[], language: string): string[] {
    if (terms.length < 2) return [];

    const separator = language === 'en' ? ' ' : '';
    const phrases: string[] = [];
    for (let i = 0; i < terms.length - 1; i++) {
      phrases.push(`${terms[i]}${separator}${terms[i + 1]}`);
    }
    return phrases;
  }

  /**
   * Select ranking profile based on query characteristics.
   *
   * Logic mirrors design.md §4.5:
   *  1. diagnosis intent → 'diagnosis'
   *  2. question-shell present (had a question starter/trailing particle) → 'faq'
   *  3. all terms are product-like (no question structure) → 'product'
   *  4. default fallback → 'default'
   */
  private selectProfile(
    raw: string,
    normalizedQuery: string,
    language: string,
    hadQuestionShell: boolean,
  ): string {
    // Rule 1: diagnosis signals (keywords: 故障, 問題, 無法, 不能, 異常, broken, broken, fault, issue, problem)
    const diagnosisZh = /(故障|問題|無法|不能|異常|損壞|壞掉|不動|卡住)/u.test(raw);
    const diagnosisEn = /\b(broken|fault|issue|problem|defect|fail|damage|stuck|not\s+work)/i.test(raw);
    if (diagnosisZh || diagnosisEn) return 'diagnosis';

    // Rule 2: had a question-shell structure → FAQ profile
    if (hadQuestionShell) return 'faq';

    // Rule 3: short noun-phrase with no question words → product profile
    const isProductLike = language === 'en'
      ? /^[A-Za-z0-9\s\-./,]+$/.test(normalizedQuery.trim()) && normalizedQuery.trim().length > 0
      : normalizedQuery.length <= 10 && !/[嗎呢啊喔好嗎如何怎麼]/.test(normalizedQuery);

    if (isProductLike && normalizedQuery.trim().length > 0) return 'product';

    return 'default';
  }

  /**
   * Detect whether the raw query contains a question-shell marker.
   * Used to snapshot question intent before normalisation strips the markers.
   */
  private hasQuestionShell(raw: string, language: string): boolean {
    if (language === 'en') {
      return RuleBasedQueryAnalyzer.EN_HAS_QUESTION_SHELL.test(raw);
    }
    return RuleBasedQueryAnalyzer.ZH_HAS_QUESTION_SHELL.test(raw);
  }

  /** Minimal CJK-aware language detector (matches QueryNormalizer.detectLang). */
  private static detectLang(text: string): string {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) return 'zh-TW';
    if (/^[\x20-\x7e]+$/.test(text)) return 'en';
    return 'zh-TW';
  }

  private emptyResult(raw: string, language: string, start: number): AnalyzedQuery {
    return {
      rawQuery: raw,
      normalizedQuery: '',
      language,
      tokens: [],
      terms: [],
      phrases: [],
      expandedTerms: [],
      matchedRules: [],
      selectedProfile: 'default',
      intentHints: [],
      debugMeta: { processingMs: Date.now() - start, normalizerSteps: [], expansionHits: 0 },
    };
  }
}
