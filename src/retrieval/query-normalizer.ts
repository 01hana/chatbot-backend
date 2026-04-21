/**
 * QueryNormalizer — FAQ-friendly query preprocessing for retrieval.
 *
 * Provides two static methods:
 *  - normalize()     strips question-shell phrases and normalises Unicode, lang-aware
 *  - extractTerms()  splits a normalised query into key terms for multi-term reranking
 *
 * Design goals:
 *  - Zero dependencies (pure static utility — no NestJS injection)
 *  - Testable in isolation
 *  - Not over-aggressive: product keywords must never be stripped
 *  - Handles both zh-TW and en queries
 */
export class QueryNormalizer {
  // ── zh-TW patterns ────────────────────────────────────────────────────────

  /**
   * Leading question-starter phrases (Chinese).
   * Examples: 請問, 想問一下, 告訴我, 想知道
   */
  private static readonly ZH_LEADING =
    /^(請問(?:一下)?|想問(?:一下)?|我想問|請幫我|幫我查|查一下|告訴我|想知道|麻煩你|請告訴我|我想了解|能告訴我)[，,\s]*/u;

  /**
   * Leading question verbs (Chinese).
   * Examples: 如何下載→下載, 怎麼聯絡→聯絡, 可以下載嗎→下載嗎
   */
  private static readonly ZH_QUESTION_VERBS =
    /^(如何|怎麼|怎樣|可以|有沒有辦法|能否)/u;

  /**
   * Trailing question particles (Chinese).
   * Examples: 螺絲類別有哪些→螺絲類別, 可以嗎→(stripped), 嗎→(stripped)
   */
  private static readonly ZH_TRAILING_PARTICLES =
    /\s*(有哪些|有哪幾種|有什麼|是什麼|怎麼樣|可以嗎|嗎|呢|啊|喔|好嗎)[？?！!。.…]*$/u;

  // ── en patterns ───────────────────────────────────────────────────────────

  /**
   * Leading question phrases (English, case-insensitive).
   * Examples:
   *   "How can I download…"  → "download…"
   *   "What screw categories…" → "screw categories…"
   *   "Where can I find…"    → "find…"
   */
  private static readonly EN_LEADING =
    /^(how\s+(?:can|do|could|would|should)\s+(?:i|we|you|one)\s+|how\s+to\s+|what\s+(?:are\s+the\s+|is\s+the\s+|types\s+of\s+|kind\s+of\s+)?|what\s+|where\s+can\s+(?:i|we)\s+|where\s+do\s+(?:i|we)\s+|can\s+(?:i|we|you)\s+|is\s+there\s+(?:a\s+way\s+to\s+)?|do\s+you\s+(?:have\s+|offer\s+|provide\s+)?|please\s+(?:tell\s+me\s+(?:about\s+)?)?|could\s+you\s+(?:tell\s+me\s+(?:about\s+)?)?)/i;

  /**
   * Trailing fillers (English, case-insensitive).
   * Examples:
   *   "screw categories do you offer?" → "screw categories"
   */
  private static readonly EN_TRAILING =
    /\s*(do\s+you\s+(?:have|offer|provide|carry)|can\s+you\s+(?:tell\s+me)?)[?!.]*$/i;

  // ── shared ────────────────────────────────────────────────────────────────

  private static readonly FULL_WIDTH = /[\uff01-\uff5e]/g;
  private static readonly TRAILING_PUNCT = /[？?！!。.…,，]+$/u;
  private static readonly WHITESPACE = /\s+/g;

  // ── English stop-words for extractTerms ──────────────────────────────────
  private static readonly EN_STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
    'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
    'should', 'may', 'might', 'i', 'we', 'you', 'it', 'its', 'my',
    'your', 'our', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'from',
    'with', 'and', 'or', 'not', 'that', 'this', 'these', 'those',
  ]);

  /**
   * Normalize a user query for retrieval.
   *
   * Steps:
   * 1. Convert full-width ASCII characters to half-width
   * 2. Strip language-specific leading question-starter phrases
   * 3. Strip language-specific trailing question particles / fillers
   * 4. Strip trailing sentence-ender punctuation
   * 5. Collapse internal whitespace
   *
   * @param raw      Raw user input string
   * @param language Optional language hint: 'zh-TW' | 'en' (auto-detected if omitted)
   * @returns        Normalised query string; falls back to trimmed `raw` if result is empty
   */
  static normalize(raw: string, language?: string): string {
    if (!raw || !raw.trim()) return '';

    let q = raw.trim();

    // 1. Full-width ASCII → half-width (！→!, ？→?, ＡＢＣ→ABC, etc.)
    q = q.replace(QueryNormalizer.FULL_WIDTH, c =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );

    const lang = language ?? QueryNormalizer.detectLang(q);

    if (lang === 'zh-TW') {
      // Strip leading starter phrases (請問, 想知道, …)
      q = q.replace(QueryNormalizer.ZH_LEADING, '').trim();
      // Strip leading question verbs (如何, 怎麼, 可以, …)
      q = q.replace(QueryNormalizer.ZH_QUESTION_VERBS, '').trim();
      // Strip trailing question particles (有哪些, 嗎, 呢, …)
      q = q.replace(QueryNormalizer.ZH_TRAILING_PARTICLES, '').trim();
    } else if (lang === 'en') {
      // Strip leading question phrases (how can I, what are, where can I, …)
      q = q.replace(QueryNormalizer.EN_LEADING, '').trim();
      // Strip trailing fillers (do you offer, can you tell me, …)
      q = q.replace(QueryNormalizer.EN_TRAILING, '').trim();
    }

    // Trailing punctuation (both languages)
    q = q.replace(QueryNormalizer.TRAILING_PUNCT, '').trim();

    // Collapse internal whitespace
    q = q.replace(QueryNormalizer.WHITESPACE, ' ').trim();

    return q.length > 0 ? q : raw.trim();
  }

  /**
   * Extract key search terms from a normalised query for multi-term reranking.
   *
   * English: splits on whitespace, filters short stop-words (< 3 chars or stop list).
   * Chinese: returns 2-character bigrams for queries longer than 4 chars; the full
   *          string for shorter queries. Bigrams approximate Chinese word boundaries.
   *
   * @param normalized Already-normalised query string
   * @param language   Optional language hint: 'zh-TW' | 'en'
   * @returns          Array of unique key terms
   */
  static extractTerms(normalized: string, language?: string): string[] {
    if (!normalized || !normalized.trim()) return [];

    const lang = language ?? QueryNormalizer.detectLang(normalized);
    const q = normalized.trim();

    if (lang === 'en') {
      return q
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length >= 3 && !QueryNormalizer.EN_STOP_WORDS.has(w));
    }

    // Chinese — single short term (≤ 2 chars): return as-is (e.g. "螺絲")
    if (q.length <= 2) {
      return q.length >= 2 ? [q] : [];
    }

    // Chinese — 3+ chars: return 2-character bigrams (unique) for multi-term reranking
    const bigrams = new Set<string>();
    for (let i = 0; i < q.length - 1; i++) {
      bigrams.add(q.slice(i, i + 2));
    }
    return Array.from(bigrams);
  }

  /**
   * Minimal language detector (CJK present → zh-TW; ASCII-only → en).
   * Used internally when the caller does not supply a language hint.
   */
  private static detectLang(text: string): string {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) return 'zh-TW';
    if (/^[\x20-\x7e]+$/.test(text)) return 'en';
    return 'zh-TW';
  }
}
