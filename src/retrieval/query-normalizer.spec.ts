import { QueryNormalizer } from './query-normalizer';

/**
 * Unit tests for QueryNormalizer.
 *
 * Covers:
 *  normalize() — Chinese: leading starters, question verbs, trailing particles
 *  normalize() — English: leading question phrases, trailing fillers
 *  normalize() — shared: full-width ASCII, trailing punctuation, whitespace
 *  normalize() — language auto-detection
 *  extractTerms() — English: stop-word filtering
 *  extractTerms() — Chinese: bigram generation
 *  extractTerms() — edge cases: empty, short
 */
describe('QueryNormalizer', () => {
  // ─── normalize: Chinese ───────────────────────────────────────────────────

  describe('normalize() — Chinese', () => {
    it('strips 請問 prefix', () => {
      expect(QueryNormalizer.normalize('請問密封件怎麼訂製？')).toBe('密封件怎麼訂製');
    });

    it('strips 想問一下 prefix', () => {
      expect(QueryNormalizer.normalize('想問一下產品規格')).toBe('產品規格');
    });

    it('strips 想知道 prefix', () => {
      expect(QueryNormalizer.normalize('想知道螺絲規格')).toBe('螺絲規格');
    });

    it('strips leading 如何 question verb', () => {
      expect(QueryNormalizer.normalize('如何下載型錄', 'zh-TW')).toBe('下載型錄');
    });

    it('strips leading 怎麼 question verb', () => {
      expect(QueryNormalizer.normalize('怎麼聯絡你們', 'zh-TW')).toBe('聯絡你們');
    });

    it('strips leading 可以 question verb', () => {
      expect(QueryNormalizer.normalize('可以下載產品目錄嗎', 'zh-TW')).toBe('下載產品目錄');
    });

    it('strips trailing 有哪些 particle', () => {
      expect(QueryNormalizer.normalize('螺絲類別有哪些', 'zh-TW')).toBe('螺絲類別');
    });

    it('strips trailing 有哪幾種 particle', () => {
      expect(QueryNormalizer.normalize('螺絲有哪幾種', 'zh-TW')).toBe('螺絲');
    });

    it('strips trailing 嗎 particle', () => {
      expect(QueryNormalizer.normalize('可以訂製嗎', 'zh-TW')).toBe('訂製');
    });

    it('preserves product keywords', () => {
      const result = QueryNormalizer.normalize('M6 六角螺栓規格', 'zh-TW');
      expect(result).toContain('六角螺栓');
      expect(result).toContain('M6');
    });

    it('returns unchanged query when nothing to strip', () => {
      expect(QueryNormalizer.normalize('客製化密封件訂製流程', 'zh-TW')).toBe('客製化密封件訂製流程');
    });
  });

  // ─── normalize: English ───────────────────────────────────────────────────

  describe('normalize() — English', () => {
    it('strips "How can I " prefix', () => {
      const result = QueryNormalizer.normalize('How can I download the product catalog?', 'en');
      expect(result).toBe('download the product catalog');
    });

    it('strips "How do I " prefix', () => {
      const result = QueryNormalizer.normalize('How do I request a quote?', 'en');
      expect(result).toBe('request a quote');
    });

    it('strips "What " prefix', () => {
      const result = QueryNormalizer.normalize('What screw categories do you offer?', 'en');
      // Leading "What " stripped, trailing "do you offer" stripped
      expect(result).toBe('screw categories');
    });

    it('strips "How can I contact you" to contact you', () => {
      const result = QueryNormalizer.normalize('How can I contact you?', 'en');
      expect(result).toBe('contact you');
    });

    it('strips "Where can I " prefix', () => {
      const result = QueryNormalizer.normalize('Where can I download the catalog?', 'en');
      expect(result).toBe('download the catalog');
    });

    it('strips "how to " prefix', () => {
      const result = QueryNormalizer.normalize('how to request a quote', 'en');
      expect(result).toBe('request a quote');
    });

    it('strips trailing "do you offer"', () => {
      const result = QueryNormalizer.normalize('screw categories do you offer?', 'en');
      expect(result).toBe('screw categories');
    });

    it('preserves product keywords', () => {
      const result = QueryNormalizer.normalize('What are M6 hex bolts?', 'en');
      expect(result).toContain('M6');
      expect(result).toContain('hex bolts');
    });

    it('returns unchanged plain English query', () => {
      expect(QueryNormalizer.normalize('product catalog download', 'en')).toBe('product catalog download');
    });
  });

  // ─── normalize: shared Unicode + whitespace ───────────────────────────────

  describe('normalize() — shared Unicode and whitespace', () => {
    it('converts full-width ASCII to half-width', () => {
      expect(QueryNormalizer.normalize('ＡＢＣ１２３')).toBe('ABC123');
    });

    it('strips trailing question marks', () => {
      expect(QueryNormalizer.normalize('產品規格？')).toBe('產品規格');
    });

    it('collapses internal whitespace', () => {
      expect(QueryNormalizer.normalize('密封  件   規格')).toBe('密封 件 規格');
    });

    it('returns empty string for empty input', () => {
      expect(QueryNormalizer.normalize('')).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(QueryNormalizer.normalize('   ')).toBe('');
    });
  });

  // ─── normalize: language auto-detection ──────────────────────────────────

  describe('normalize() — language auto-detection', () => {
    it('auto-detects Chinese query and strips 有哪些 without explicit language', () => {
      expect(QueryNormalizer.normalize('螺絲類別有哪些')).toBe('螺絲類別');
    });

    it('auto-detects English query and strips "How can I" without explicit language', () => {
      const result = QueryNormalizer.normalize('How can I download the product catalog?');
      expect(result).toBe('download the product catalog');
    });

    it('auto-detects mixed CJK+ASCII as zh-TW', () => {
      // Has CJK character → treated as zh-TW
      const result = QueryNormalizer.normalize('如何選購 M6 螺絲');
      expect(result).toContain('M6');
      expect(result).toContain('螺絲');
    });
  });

  // ─── extractTerms: English ────────────────────────────────────────────────

  describe('extractTerms() — English', () => {
    it('returns meaningful words from English query', () => {
      const terms = QueryNormalizer.extractTerms('download the product catalog', 'en');
      expect(terms).toContain('download');
      expect(terms).toContain('product');
      expect(terms).toContain('catalog');
    });

    it('filters stop words from English terms', () => {
      const terms = QueryNormalizer.extractTerms('download the product catalog', 'en');
      expect(terms).not.toContain('the');
    });

    it('filters short words (< 3 chars) from English terms', () => {
      const terms = QueryNormalizer.extractTerms('request a quote', 'en');
      expect(terms).not.toContain('a');
    });

    it('returns empty array for empty English input', () => {
      expect(QueryNormalizer.extractTerms('', 'en')).toEqual([]);
    });
  });

  // ─── extractTerms: Chinese ────────────────────────────────────────────────

  describe('extractTerms() — Chinese', () => {
    it('returns bigrams for longer Chinese query', () => {
      const terms = QueryNormalizer.extractTerms('螺絲類別', 'zh-TW');
      expect(terms).toContain('螺絲');
      expect(terms).toContain('絲類');
      expect(terms).toContain('類別');
    });

    it('returns single term for short Chinese query (≤ 4 chars)', () => {
      const terms = QueryNormalizer.extractTerms('螺絲', 'zh-TW');
      expect(terms).toEqual(['螺絲']);
    });

    it('returns empty array for empty Chinese input', () => {
      expect(QueryNormalizer.extractTerms('', 'zh-TW')).toEqual([]);
    });

    it('deduplicates bigrams', () => {
      const terms = QueryNormalizer.extractTerms('螺螺螺', 'zh-TW');
      const unique = new Set(terms);
      expect(unique.size).toBe(terms.length);
    });
  });

  // ─── extractTerms: FAQ use-case traces ────────────────────────────────────

  describe('extractTerms() — FAQ use-case traces', () => {
    it('extracts terms from normalized Chinese catalog query', () => {
      const normalized = QueryNormalizer.normalize('可以下載產品目錄嗎', 'zh-TW');
      const terms = QueryNormalizer.extractTerms(normalized, 'zh-TW');
      // normalized = "下載產品目錄", bigrams include "下載", "載產", etc.
      expect(normalized).toBe('下載產品目錄');
      expect(terms).toContain('下載');
    });

    it('extracts terms from normalized English catalog query', () => {
      const normalized = QueryNormalizer.normalize('How can I download the product catalog?', 'en');
      const terms = QueryNormalizer.extractTerms(normalized, 'en');
      // normalized = "download the product catalog"
      expect(terms).toContain('download');
      expect(terms).toContain('product');
      expect(terms).toContain('catalog');
      expect(terms).not.toContain('the');
    });

    it('extracts terms from normalized screw categories query', () => {
      const normalized = QueryNormalizer.normalize('螺絲類別有哪些', 'zh-TW');
      const terms = QueryNormalizer.extractTerms(normalized, 'zh-TW');
      expect(normalized).toBe('螺絲類別');
      expect(terms).toContain('螺絲');
    });
  });
});
