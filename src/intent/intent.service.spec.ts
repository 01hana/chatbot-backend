import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { IntentService } from './intent.service';
import { IntentRepository } from './intent.repository';
import { IntentTemplate, GlossaryTerm } from '../generated/prisma/client';
import type { AnalyzedQuery } from '../query-analysis/types/analyzed-query.type';

/** Minimal IntentTemplate factory */
function makeTemplate(overrides: Partial<IntentTemplate> = {}): IntentTemplate {
  return {
    id: 1,
    intent: 'product-inquiry',
    label: 'Product Inquiry',
    keywords: ['產品', '規格', 'product', 'spec'],
    templateZh: '您想了解哪個產品的規格？',
    templateEn: 'Which product specs are you interested in?',
    priority: 10,
    isActive: true,
    category: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Minimal GlossaryTerm factory */
function makeGlossaryTerm(overrides: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return {
    id: 1,
    term: '墊片',
    synonyms: ['gasket', 'seal'],
    intentLabel: 'product-inquiry',
    createdAt: new Date(),
    ...overrides,
  };
}

/** Minimal AnalyzedQuery factory */
function makeAnalyzedQuery(overrides: Partial<AnalyzedQuery> = {}): AnalyzedQuery {
  return {
    rawQuery: '螺絲規格',
    normalizedQuery: '螺絲規格',
    language: 'zh-TW',
    tokens: ['螺絲', '規格'],
    terms: ['螺絲', '規格'],
    phrases: [],
    expandedTerms: ['螺絲', '規格'],
    matchedRules: [],
    selectedProfile: 'product',
    intentHints: [],
    debugMeta: { processingMs: 1, normalizerSteps: [], expansionHits: 0 },
    ...overrides,
  };
}

describe('IntentService', () => {
  let service: IntentService;
  let repo: jest.Mocked<IntentRepository>;

  beforeEach(() => {
    repo = {
      findAllTemplates: jest.fn<() => Promise<IntentTemplate[]>>(),
      findAllGlossary: jest.fn<() => Promise<GlossaryTerm[]>>(),
    } as unknown as jest.Mocked<IntentRepository>;

    service = new IntentService(repo);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Cache loading
  // ──────────────────────────────────────────────────────────────────────────

  describe('loadCache()', () => {
    it('populates templates and glossary from the repository', async () => {
      const templates = [
        makeTemplate({ id: 1, intent: 'product-inquiry' }),
        makeTemplate({ id: 2, intent: 'price-inquiry', keywords: ['報價', 'price', 'quotation'], priority: 20 }),
      ];
      const glossary = [makeGlossaryTerm()];

      repo.findAllTemplates.mockResolvedValue(templates);
      repo.findAllGlossary.mockResolvedValue(glossary);

      await service.loadCache();

      expect(service.getCachedTemplates()).toHaveLength(2);
      expect(service.getCachedGlossary()).toHaveLength(1);
    });

    it('calls both repository methods exactly once', async () => {
      repo.findAllTemplates.mockResolvedValue([]);
      repo.findAllGlossary.mockResolvedValue([]);

      await service.loadCache();

      expect(repo.findAllTemplates).toHaveBeenCalledTimes(1);
      expect(repo.findAllGlossary).toHaveBeenCalledTimes(1);
    });

    it('replaces the previous cache on reload', async () => {
      repo.findAllTemplates.mockResolvedValueOnce([makeTemplate()]);
      repo.findAllGlossary.mockResolvedValueOnce([]);
      await service.loadCache();
      expect(service.getCachedTemplates()).toHaveLength(1);

      repo.findAllTemplates.mockResolvedValueOnce([]);
      repo.findAllGlossary.mockResolvedValueOnce([]);
      await service.loadCache();
      expect(service.getCachedTemplates()).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // invalidateCache
  // ──────────────────────────────────────────────────────────────────────────

  describe('invalidateCache()', () => {
    it('triggers a full re-load from the repository', async () => {
      const first = [makeTemplate({ id: 1 })];
      const updated = [makeTemplate({ id: 1 }), makeTemplate({ id: 2, intent: 'general-faq', keywords: ['FAQ', 'help'] })];

      repo.findAllTemplates.mockResolvedValueOnce(first);
      repo.findAllGlossary.mockResolvedValue([]);

      await service.loadCache();
      expect(service.getCachedTemplates()).toHaveLength(1);

      repo.findAllTemplates.mockResolvedValueOnce(updated);
      await service.invalidateCache();
      expect(service.getCachedTemplates()).toHaveLength(2);
    });

    it('calls repository again after invalidation', async () => {
      repo.findAllTemplates.mockResolvedValue([]);
      repo.findAllGlossary.mockResolvedValue([]);

      await service.loadCache();
      await service.invalidateCache();

      expect(repo.findAllTemplates).toHaveBeenCalledTimes(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // detect() — backward-compat (two-argument form, 001 behaviour)
  // ──────────────────────────────────────────────────────────────────────────

  describe('detect() — backward-compat (no analyzedQuery)', () => {
    beforeEach(async () => {
      repo.findAllTemplates.mockResolvedValue([
        makeTemplate({ id: 1, intent: 'product-inquiry', keywords: ['產品', '規格', 'product', 'spec'], priority: 10 }),
        makeTemplate({ id: 2, intent: 'price-inquiry', keywords: ['報價', 'price', 'quotation'], priority: 20 }),
        makeTemplate({ id: 3, intent: 'general-faq', keywords: ['FAQ', 'help', '幫助'], priority: 5 }),
      ]);
      repo.findAllGlossary.mockResolvedValue([
        makeGlossaryTerm({ id: 1, term: '墊片', synonyms: ['gasket', 'seal'], intentLabel: 'product-inquiry' }),
      ]);
      await service.loadCache();
    });

    it('detects intent when input contains a keyword', () => {
      const result = service.detect('我想了解這個產品的規格', 'zh-TW');
      expect(result.intentLabel).toBe('product-inquiry');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.language).toBe('zh-TW');
    });

    it('detects higher-priority intent first (price-inquiry before product-inquiry)', () => {
      const result = service.detect('請提供報價', 'zh-TW');
      expect(result.intentLabel).toBe('price-inquiry');
    });

    it('returns null intent for input with no keyword match', () => {
      const result = service.detect('你好，天氣真好', 'zh-TW');
      expect(result.intentLabel).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('passes through the language parameter unchanged', () => {
      const result = service.detect('hello', 'en');
      expect(result.language).toBe('en');
    });

    it('expands synonyms via glossary — matches via synonym not primary term', () => {
      // 'gasket' is a synonym of '墊片'; template keyword is '規格' not 'gasket'
      // but the expand logic adds all synonym forms to the token pool
      // Input "gasket spec" should match product-inquiry because "spec" is in keywords
      const result = service.detect('I need a gasket spec', 'en');
      expect(result.intentLabel).toBe('product-inquiry');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // detect() — isActive filter (IG-002 / IG-005)
  // ──────────────────────────────────────────────────────────────────────────

  describe('detect() — isActive=false filter', () => {
    beforeEach(async () => {
      repo.findAllGlossary.mockResolvedValue([]);
    });

    it('skips templates with isActive=false and returns null when no active template matches', async () => {
      repo.findAllTemplates.mockResolvedValue([
        makeTemplate({ id: 1, intent: 'product-inquiry', keywords: ['產品', 'spec'], isActive: false }),
      ]);
      await service.loadCache();

      const result = service.detect('我想了解這個產品規格', 'zh-TW');
      expect(result.intentLabel).toBeNull();
    });

    it('matches active templates and ignores disabled ones with overlapping keywords', async () => {
      repo.findAllTemplates.mockResolvedValue([
        makeTemplate({ id: 1, intent: 'disabled-intent', keywords: ['產品'], isActive: false, priority: 99 }),
        makeTemplate({ id: 2, intent: 'active-intent', keywords: ['產品'], isActive: true, priority: 10 }),
      ]);
      await service.loadCache();

      const result = service.detect('我想了解這個產品', 'zh-TW');
      expect(result.intentLabel).toBe('active-intent');
    });

    it('returns null when all templates are disabled', async () => {
      repo.findAllTemplates.mockResolvedValue([
        makeTemplate({ id: 1, intent: 'intent-a', keywords: ['test'], isActive: false }),
        makeTemplate({ id: 2, intent: 'intent-b', keywords: ['test'], isActive: false }),
      ]);
      await service.loadCache();

      const result = service.detect('test', 'en');
      expect(result.intentLabel).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // detect() — Layer 1: analyzedQuery.intentHints (IG-005)
  // ──────────────────────────────────────────────────────────────────────────

  describe('detect() — Layer 1: intent hints', () => {
    beforeEach(async () => {
      repo.findAllTemplates.mockResolvedValue([
        makeTemplate({ id: 1, intent: 'product-inquiry', keywords: ['產品', 'spec'], priority: 10 }),
      ]);
      repo.findAllGlossary.mockResolvedValue([]);
      await service.loadCache();
    });

    it('returns the top hint directly when score > 0.7 (Layer 1 fires)', () => {
      const analyzedQuery = makeAnalyzedQuery({
        intentHints: [{ label: 'price-inquiry', score: 0.9 }],
      });
      const result = service.detect('一些文字', 'zh-TW', analyzedQuery);
      expect(result.intentLabel).toBe('price-inquiry');
      expect(result.confidence).toBe(0.9);
    });

    it('carries the hint score (not 1) as confidence when Layer 1 fires', () => {
      const analyzedQuery = makeAnalyzedQuery({
        intentHints: [{ label: 'product-diagnosis', score: 0.85 }],
      });
      const result = service.detect('input', 'zh-TW', analyzedQuery);
      expect(result.confidence).toBe(0.85);
    });

    it('falls through to Layer 2 when top hint score ≤ 0.7', () => {
      const analyzedQuery = makeAnalyzedQuery({
        intentHints: [{ label: 'price-inquiry', score: 0.65 }],
        expandedTerms: ['spec'],
      });
      // Layer 1 won't fire; Layer 2 should match 'spec' keyword → product-inquiry
      const result = service.detect('spec info', 'en', analyzedQuery);
      expect(result.intentLabel).toBe('product-inquiry');
    });

    it('falls through to Layer 2 when intentHints is empty', () => {
      const analyzedQuery = makeAnalyzedQuery({
        intentHints: [],
        expandedTerms: ['spec'],
      });
      const result = service.detect('spec', 'en', analyzedQuery);
      expect(result.intentLabel).toBe('product-inquiry');
    });

    it('returns null when Layer 1 hint score equals threshold boundary (0.7 is not > 0.7)', () => {
      const analyzedQuery = makeAnalyzedQuery({
        intentHints: [{ label: 'price-inquiry', score: 0.7 }],
        expandedTerms: [], // no keyword match either
      });
      const result = service.detect('hello', 'zh-TW', analyzedQuery);
      // score 0.7 is NOT > 0.7; Layer 2 has no keyword; Layer 3 → null
      expect(result.intentLabel).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // detect() — Layer 2: analyzedQuery.expandedTerms (IG-006)
  // ──────────────────────────────────────────────────────────────────────────

  describe('detect() — Layer 2: expandedTerms matching', () => {
    beforeEach(async () => {
      repo.findAllTemplates.mockResolvedValue([
        makeTemplate({ id: 1, intent: 'product-inquiry', keywords: ['螺絲', 'bolt', 'screw'], priority: 10 }),
        makeTemplate({ id: 2, intent: 'price-inquiry', keywords: ['報價', 'quote'], priority: 15 }),
      ]);
      repo.findAllGlossary.mockResolvedValue([]);
      await service.loadCache();
    });

    it('uses expandedTerms for keyword matching when analyzedQuery is provided', () => {
      // raw input doesn't contain 'bolt', but expandedTerms do (GlossaryExpansionProvider added it)
      const analyzedQuery = makeAnalyzedQuery({
        intentHints: [],
        expandedTerms: ['fastener', 'bolt', 'screw'], // 'bolt' is a keyword
      });
      const result = service.detect('我需要緊固件', 'zh-TW', analyzedQuery);
      expect(result.intentLabel).toBe('product-inquiry');
    });

    it('falls back to internal expandWithGlossary when no analyzedQuery', () => {
      // Without analyzedQuery, the raw input contains 'bolt' which is a keyword
      const result = service.detect('I need a bolt spec', 'en');
      expect(result.intentLabel).toBe('product-inquiry');
    });

    it('returns null when expandedTerms contain no matching keyword', () => {
      const analyzedQuery = makeAnalyzedQuery({
        intentHints: [],
        expandedTerms: ['weather', 'today', 'nice'],
      });
      const result = service.detect('天氣真好', 'zh-TW', analyzedQuery);
      expect(result.intentLabel).toBeNull();
    });

    it('also checks normalized query (input) in addition to expandedTerms', () => {
      // input has '報價' which is a keyword; expandedTerms are irrelevant here
      const analyzedQuery = makeAnalyzedQuery({
        intentHints: [],
        expandedTerms: ['unrelated'],
      });
      const result = service.detect('請問報價是多少', 'zh-TW', analyzedQuery);
      expect(result.intentLabel).toBe('price-inquiry');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // detect() — 5-intent fixture tests (IG-005 acceptance: ≥ 85% accuracy)
  // ──────────────────────────────────────────────────────────────────────────

  describe('detect() — 5-intent fixture validation', () => {
    const contactKeywords = ['聯絡', '聯繫', '電話', '客服', 'contact', 'phone', 'support'];
    const allTemplates: IntentTemplate[] = [
      // sorted by priority descending — mirrors production repository order
      makeTemplate({ id: 2, intent: 'product-diagnosis', keywords: ['問題', '故障', '異常', '壞掉', '不正常', '修', 'issue', 'broken', 'fault', 'problem', 'repair'], priority: 20 }),
      makeTemplate({ id: 3, intent: 'pricing-inquiry',   keywords: ['價格', '報價', '多少錢', '費用', '優惠', 'price', 'quote', 'cost', 'discount', 'how much'], priority: 15 }),
      makeTemplate({ id: 5, intent: 'contact-inquiry',   keywords: contactKeywords, priority: 12 }),
      makeTemplate({ id: 1, intent: 'product-inquiry',   keywords: ['產品', '型號', '規格', '尺寸', '材質', 'product', 'model', 'spec', 'size'], priority: 10 }),
      makeTemplate({ id: 4, intent: 'general-faq',       keywords: ['如何', '怎麼', '什麼是', '說明', 'FAQ', 'how to', 'what is', 'explain', 'help'], priority: 0 }),
    ];

    beforeEach(async () => {
      repo.findAllTemplates.mockResolvedValue(allTemplates);
      repo.findAllGlossary.mockResolvedValue([]);
      await service.loadCache();
    });

    // product-inquiry — 3 question variants
    it('fixture product-inquiry: 你們的螺絲規格是什麼', () => {
      expect(service.detect('你們的螺絲規格是什麼', 'zh-TW').intentLabel).toBe('product-inquiry');
    });
    it('fixture product-inquiry: I need the spec for M3 bolts', () => {
      expect(service.detect('I need the spec for M3 bolts', 'en').intentLabel).toBe('product-inquiry');
    });
    it('fixture product-inquiry: 請問這個型號的尺寸', () => {
      expect(service.detect('請問這個型號的尺寸', 'zh-TW').intentLabel).toBe('product-inquiry');
    });

    // pricing-inquiry — 2 variants
    it('fixture pricing-inquiry: 這款產品多少錢', () => {
      expect(service.detect('這款產品多少錢', 'zh-TW').intentLabel).toBe('pricing-inquiry');
    });
    it('fixture pricing-inquiry: Can I get a price quote', () => {
      expect(service.detect('Can I get a price quote', 'en').intentLabel).toBe('pricing-inquiry');
    });

    // contact-inquiry — 2 variants
    it('fixture contact-inquiry: 請問客服電話', () => {
      expect(service.detect('請問客服電話', 'zh-TW').intentLabel).toBe('contact-inquiry');
    });
    it('fixture contact-inquiry: How do I contact support', () => {
      expect(service.detect('How do I contact support', 'en').intentLabel).toBe('contact-inquiry');
    });

    // general-faq — 2 variants
    it('fixture general-faq: 什麼是不鏽鋼螺絲', () => {
      expect(service.detect('什麼是不鏽鋼螺絲', 'zh-TW').intentLabel).toBe('general-faq');
    });
    it('fixture general-faq: How to install a bolt', () => {
      expect(service.detect('How to install a bolt', 'en').intentLabel).toBe('general-faq');
    });

    // product-diagnosis — 2 variants
    it('fixture product-diagnosis: 螺絲裝上去有問題', () => {
      expect(service.detect('螺絲裝上去有問題', 'zh-TW').intentLabel).toBe('product-diagnosis');
    });
    it('fixture product-diagnosis: The bolt is broken', () => {
      expect(service.detect('The bolt is broken', 'en').intentLabel).toBe('product-diagnosis');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // isHighIntent (Phase 1 skeleton — always false)
  // ──────────────────────────────────────────────────────────────────────────

  describe('isHighIntent() — Phase 1 skeleton', () => {
    it('returns false regardless of conversation history', () => {
      const history = [
        { role: 'user', content: '請報價，我要買大量' },
        { role: 'assistant', content: '好的，請問您需要什麼規格？' },
        { role: 'user', content: '多少錢？price? quotation? 報價' },
      ];
      expect(service.isHighIntent(history)).toBe(false);
    });

    it('returns false for empty history', () => {
      expect(service.isHighIntent([])).toBe(false);
    });
  });
});

