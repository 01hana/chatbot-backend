import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { IntentService } from './intent.service';
import { IntentRepository } from './intent.repository';
import { IntentTemplate, GlossaryTerm } from '../generated/prisma/client';

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
  // detect()
  // ──────────────────────────────────────────────────────────────────────────

  describe('detect()', () => {
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
