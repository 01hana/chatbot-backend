import { RuleBasedQueryAnalyzer } from './rule-based-query-analyzer';

describe('RuleBasedQueryAnalyzer', () => {
  const analyzer = new RuleBasedQueryAnalyzer();

  // ── normalizedQuery: Chinese ──────────────────────────────────────────────

  describe('normalizedQuery — zh-TW', () => {
    it('strips 請問 prefix (task spec case)', async () => {
      // 請問你們有哪些螺絲類別
      // Strips 請問 → 你們有哪些螺絲類別
      // normalizedQuery contains 螺絲類別
      const result = await analyzer.analyze('請問你們有哪些螺絲類別', 'zh-TW');
      expect(result.normalizedQuery).toContain('螺絲類別');
      expect(result.matchedRules).toContain('zh-leading');
    });

    it('strips 想問一下 prefix', async () => {
      const result = await analyzer.analyze('想問一下產品規格', 'zh-TW');
      expect(result.normalizedQuery).toBe('產品規格');
    });

    it('strips trailing 有哪些 particle', async () => {
      const result = await analyzer.analyze('螺絲類別有哪些', 'zh-TW');
      expect(result.normalizedQuery).toBe('螺絲類別');
    });

    it('strips trailing 嗎 particle', async () => {
      const result = await analyzer.analyze('可以訂製嗎', 'zh-TW');
      expect(result.normalizedQuery).toBe('訂製');
    });

    it('strips leading 如何 verb', async () => {
      const result = await analyzer.analyze('如何下載型錄', 'zh-TW');
      expect(result.normalizedQuery).toBe('下載型錄');
    });

    it('converts full-width to half-width', async () => {
      const result = await analyzer.analyze('ＡＢＣ１２３', 'zh-TW');
      expect(result.normalizedQuery).toBe('ABC123');
    });

    it('preserves product keywords like M6 六角螺栓', async () => {
      const result = await analyzer.analyze('M6 六角螺栓規格', 'zh-TW');
      expect(result.normalizedQuery).toContain('六角螺栓');
      expect(result.normalizedQuery).toContain('M6');
    });

    it('returns rawQuery fallback when entire query is stripped', async () => {
      // Edge: a single stop-word query — normalizedQuery falls back to trimmed raw
      const result = await analyzer.analyze('螺絲', 'zh-TW');
      expect(result.normalizedQuery.length).toBeGreaterThan(0);
    });
  });

  // ── normalizedQuery: English ──────────────────────────────────────────────

  describe('normalizedQuery — English', () => {
    it('strips "How can I " prefix', async () => {
      const result = await analyzer.analyze('How can I download the product catalog?', 'en');
      expect(result.normalizedQuery).toBe('download the product catalog');
    });

    it('strips "What screw categories do you offer?"', async () => {
      const result = await analyzer.analyze('What screw categories do you offer?', 'en');
      expect(result.normalizedQuery).toBe('screw categories');
    });

    it('strips "how to " prefix', async () => {
      const result = await analyzer.analyze('how to request a quote', 'en');
      expect(result.normalizedQuery).toBe('request a quote');
    });

    it('preserves product keywords M6 hex bolts', async () => {
      const result = await analyzer.analyze('What are M6 hex bolts?', 'en');
      expect(result.normalizedQuery).toContain('M6');
      expect(result.normalizedQuery).toContain('hex bolts');
    });
  });

  // ── tokens ────────────────────────────────────────────────────────────────

  describe('tokens', () => {
    it('produces tokens for en query', async () => {
      const result = await analyzer.analyze('M3 stainless steel bolts', 'en');
      expect(result.tokens).toContain('M3');
      expect(result.tokens).toContain('stainless');
      expect(result.tokens).toContain('steel');
      expect(result.tokens).toContain('bolts');
    });

    it('produces CJK tokens for zh-TW query', async () => {
      const result = await analyzer.analyze('螺絲類別', 'zh-TW');
      expect(result.tokens.length).toBeGreaterThan(0);
    });
  });

  // ── terms ─────────────────────────────────────────────────────────────────

  describe('terms', () => {
    it('filters English stop words from terms', async () => {
      const result = await analyzer.analyze('M3 stainless steel bolts', 'en');
      expect(result.terms).not.toContain('a');
      expect(result.terms).not.toContain('the');
      expect(result.terms).toContain('stainless');
      expect(result.terms).toContain('steel');
      expect(result.terms).toContain('bolts');
    });

    it('includes M3 as a zh-TW term (ASCII alphanumeric)', async () => {
      const result = await analyzer.analyze('M3螺絲規格', 'zh-TW');
      expect(result.terms).toContain('M3');
    });

    it('excludes single CJK chars from terms (too ambiguous)', async () => {
      const result = await analyzer.analyze('螺絲', 'zh-TW');
      // Single chars ('螺', '絲') should not appear as terms since length < 2
      // (they are 1-char tokens from the tokenizer)
      result.terms.forEach(t => {
        const isCjkOnly = /^[\u4e00-\u9fff]+$/.test(t);
        if (isCjkOnly) expect(t.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // ── phrases ───────────────────────────────────────────────────────────────

  describe('phrases', () => {
    it('produces bi-gram phrases from terms (English)', async () => {
      const result = await analyzer.analyze('stainless steel bolts', 'en');
      // terms ≈ ['stainless', 'steel', 'bolts']
      // phrases ≈ ['stainless steel', 'steel bolts']
      expect(result.phrases.some(p => p.includes('stainless'))).toBe(true);
    });

    it('returns empty phrases when only one term', async () => {
      const result = await analyzer.analyze('螺絲', 'zh-TW');
      // normalised to 螺絲, which may yield 0 or 1 term — no bi-gram possible
      if (result.terms.length < 2) {
        expect(result.phrases).toHaveLength(0);
      }
    });
  });

  // ── selectedProfile ───────────────────────────────────────────────────────

  describe('selectedProfile', () => {
    it('selects "faq" for question-shell query', async () => {
      const result = await analyzer.analyze('請問你們有哪些螺絲類別', 'zh-TW');
      expect(result.selectedProfile).toBe('faq');
    });

    it('selects "faq" for English question query', async () => {
      const result = await analyzer.analyze('What screw categories do you offer?', 'en');
      expect(result.selectedProfile).toBe('faq');
    });

    it('selects "product" for plain product noun-phrase (en)', async () => {
      const result = await analyzer.analyze('M3 stainless steel bolts', 'en');
      expect(result.selectedProfile).toBe('product');
    });

    it('selects "diagnosis" when fault keywords present (zh-TW)', async () => {
      const result = await analyzer.analyze('螺絲故障無法旋緊', 'zh-TW');
      expect(result.selectedProfile).toBe('diagnosis');
    });

    it('selects "diagnosis" when fault keywords present (en)', async () => {
      const result = await analyzer.analyze('the bolt is broken and stuck', 'en');
      expect(result.selectedProfile).toBe('diagnosis');
    });
  });

  // ── matchedRules ──────────────────────────────────────────────────────────

  describe('matchedRules', () => {
    it('records zh-leading rule when triggered', async () => {
      const result = await analyzer.analyze('請問螺絲類別有哪些', 'zh-TW');
      expect(result.matchedRules).toContain('zh-leading');
    });

    it('records zh-trailing-particles rule when triggered', async () => {
      const result = await analyzer.analyze('螺絲類別有哪些', 'zh-TW');
      expect(result.matchedRules).toContain('zh-trailing-particles');
    });

    it('records en-leading rule when triggered', async () => {
      const result = await analyzer.analyze('How can I download the catalog?', 'en');
      expect(result.matchedRules).toContain('en-leading');
    });

    it('is empty when no rules are triggered', async () => {
      const result = await analyzer.analyze('M3 stainless steel bolts', 'en');
      expect(result.matchedRules).toHaveLength(0);
    });
  });

  // ── debugMeta ─────────────────────────────────────────────────────────────

  describe('debugMeta', () => {
    it('records processingMs as a non-negative number', async () => {
      const result = await analyzer.analyze('請問螺絲類別', 'zh-TW');
      expect(result.debugMeta.processingMs).toBeGreaterThanOrEqual(0);
    });

    it('records normalizerSteps', async () => {
      const result = await analyzer.analyze('請問螺絲類別', 'zh-TW');
      expect(result.debugMeta.normalizerSteps.length).toBeGreaterThan(0);
    });

    it('reports expansionHits as 0 when no expansion provider', async () => {
      const result = await analyzer.analyze('螺絲', 'zh-TW');
      expect(result.debugMeta.expansionHits).toBe(0);
    });
  });

  // ── language auto-detection ───────────────────────────────────────────────

  describe('language auto-detection', () => {
    it('auto-detects zh-TW for Chinese input', async () => {
      const result = await analyzer.analyze('螺絲類別有哪些');
      expect(result.language).toBe('zh-TW');
    });

    it('auto-detects en for ASCII input', async () => {
      const result = await analyzer.analyze('M3 stainless steel bolts');
      expect(result.language).toBe('en');
    });
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty result for empty input', async () => {
      const result = await analyzer.analyze('');
      expect(result.normalizedQuery).toBe('');
      expect(result.tokens).toHaveLength(0);
    });

    it('returns empty result for whitespace-only input', async () => {
      const result = await analyzer.analyze('   ');
      expect(result.normalizedQuery).toBe('');
    });

    it('rawQuery is always preserved', async () => {
      const raw = '  請問螺絲  ';
      const result = await analyzer.analyze(raw, 'zh-TW');
      expect(result.rawQuery).toBe(raw);
    });
  });

  // ── expansion provider stub ───────────────────────────────────────────────

  describe('expansion provider (stub)', () => {
    it('uses expansion provider when supplied', async () => {
      const stubProvider = {
        expand: async (terms: string[]) => [...terms, '螺釘'],
      };
      const analyzerWithExpansion = new RuleBasedQueryAnalyzer(undefined, stubProvider);
      const result = await analyzerWithExpansion.analyze('螺絲規格', 'zh-TW');
      expect(result.expandedTerms).toContain('螺釘');
      expect(result.debugMeta.expansionHits).toBeGreaterThan(0);
    });

    it('expandedTerms equals terms when no provider', async () => {
      const result = await analyzer.analyze('M3 stainless steel bolts', 'en');
      expect(result.expandedTerms).toEqual(result.terms);
    });
  });

  // ── noise words filtering (QA-003 gap closure) ────────────────────────────

  describe('noise words filtering (via ruleProvider)', () => {
    const noiseRuleProvider = {
      getStopWords: async (_lang: string) => new Set<string>(),
      getNoiseWords: async (lang: string) =>
        lang === 'zh-TW'
          ? new Set(['一些', '一下', '一點', '相關'])
          : new Set<string>(),
      getQuestionShellPatterns: async (_lang: string) => [] as RegExp[],
      invalidateCache: () => {},
    };

    it('Case A — compound noise words are removed from the token stream', async () => {
      const analyzerWithNoise = new RuleBasedQueryAnalyzer(noiseRuleProvider);
      // '一些' and '相關' are removed at string level before tokenisation.
      // tokenInput becomes '螺絲規格' → 4 individual CJK chars.
      const result = await analyzerWithNoise.analyze('一些螺絲相關規格', 'zh-TW');
      // '些' only appears in '一些' in this input; absent after noise filtering.
      expect(result.tokens).not.toContain('些');
      // Signal characters remain in the token stream.
      expect(result.tokens).toContain('螺');
      expect(result.tokens).toContain('規');
      expect(result.tokens.length).toBe(4); // '螺','絲','規','格'
    });

    it('Case B — standalone noise word is stripped before tokenisation', async () => {
      const analyzerWithNoise = new RuleBasedQueryAnalyzer(noiseRuleProvider);
      // '一下' is a standalone noise word (not inside a question-shell here).
      // tokenInput becomes '查詢規格' → 4 chars.
      const result = await analyzerWithNoise.analyze('查詢一下規格', 'zh-TW');
      expect(result.tokens.length).toBe(4); // '查','詢','規','格'
      expect(result.tokens).toContain('查');
      expect(result.tokens).toContain('規');
    });

    it('Case C — empty noise word set does not affect English terms', async () => {
      const analyzerWithNoise = new RuleBasedQueryAnalyzer(noiseRuleProvider);
      const resultWithNoise = await analyzerWithNoise.analyze('M3 stainless steel bolts', 'en');
      const resultBaseline = await analyzer.analyze('M3 stainless steel bolts', 'en');
      expect(resultWithNoise.terms).toEqual(resultBaseline.terms);
    });

    it('no ruleProvider — noiseWords is empty, token stream is unaffected', async () => {
      // Without a ruleProvider, noiseWordsForLang is an empty Set so tokenInput
      // equals normalizedQuery and all chars are tokenised.
      const result = await analyzer.analyze('螺絲規格', 'zh-TW');
      expect(result.tokens.length).toBeGreaterThan(0);
      expect(result.tokens).toContain('螺');
    });
  });
});

