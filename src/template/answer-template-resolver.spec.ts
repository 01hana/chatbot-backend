import { AnswerTemplateResolver } from './answer-template-resolver';
import type { KnowledgeEntry } from '../generated/prisma/client';
import type { RetrievalResult } from '../retrieval/types/retrieval.types';

/**
 * TM-001 — Unit tests for AnswerTemplateResolver.
 *
 * Covers all four strategy paths plus edge cases:
 *  - answerType='template'      → strategy='template', resolvedContent=entry.content
 *  - answerType='rag+template'  → strategy='rag+template', resolvedContent filled
 *  - answerType='rag' (default) → strategy='rag', no resolvedContent
 *  - answerType='llm'           → strategy='llm', no resolvedContent
 *  - ragResults empty           → strategy='llm' (no_rag_results reason)
 *  - rag+template: {content} placeholder substitution
 *  - rag+template: no placeholder → append after blank line
 *  - rag+template: no matching template → fallback to raw content
 *  - rag+template: intentLabel=null → fallback to raw content
 *  - rag+template: language='en' picks templateEn
 *  - template path is deterministic (same input → same output)
 *  - unknown answerType value treated as 'rag'
 */
describe('AnswerTemplateResolver', () => {
  function makeKnowledgeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
    return {
      id: 1,
      title: '測試條目',
      content: '螺絲規格：M3 × 10mm，不鏽鋼 SUS304',
      intentLabel: 'product-inquiry',
      tags: [],
      aliases: [],
      language: 'zh-TW',
      status: 'published',
      visibility: 'public',
      version: 1,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      deletedAt: null,
      sourceKey: 'screw-spec',
      category: null,
      answerType: 'rag',
      templateKey: null,
      faqQuestions: [],
      crossLanguageGroupKey: null,
      structuredAttributes: null,
      ...overrides,
    } as KnowledgeEntry;
  }

  function makeRetrievalResult(entryOverrides: Partial<KnowledgeEntry> = {}): RetrievalResult {
    return {
      entry: makeKnowledgeEntry(entryOverrides),
      score: 0.85,
    };
  }

  const makeIntentService = (templates: unknown[] = []) => ({
    getCachedTemplates: jest.fn().mockReturnValue(templates),
  });

  // ── Four-path core decisions ───────────────────────────────────────────

  describe('strategy=template', () => {
    it('returns template strategy with entry.content as resolvedContent', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService() as never);
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'template', content: '直接回覆文字' })],
        null,
        'zh-TW',
      );
      expect(result.strategy).toBe('template');
      expect(result.resolvedContent).toBe('直接回覆文字');
      expect(result.reason).toContain('template:');
    });

    it('uses sourceKey in reason when present', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService() as never);
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'template', sourceKey: 'faq-return-policy' })],
        null,
        'zh-TW',
      );
      expect(result.reason).toContain('faq-return-policy');
    });

    it('falls back to id in reason when sourceKey is null', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService() as never);
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'template', sourceKey: null })],
        null,
        'zh-TW',
      );
      expect(result.reason).toContain('1'); // entry.id
    });

    it('is deterministic — same inputs produce identical output', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService() as never);
      const results = [
        resolver.resolve([makeRetrievalResult({ answerType: 'template', content: '固定文字' })], null, 'zh-TW'),
        resolver.resolve([makeRetrievalResult({ answerType: 'template', content: '固定文字' })], null, 'zh-TW'),
        resolver.resolve([makeRetrievalResult({ answerType: 'template', content: '固定文字' })], null, 'zh-TW'),
      ];
      for (const r of results) {
        expect(r.strategy).toBe('template');
        expect(r.resolvedContent).toBe('固定文字');
      }
    });
  });

  describe('strategy=rag+template', () => {
    it('substitutes {content} placeholder with entry content (zh-TW)', () => {
      const resolver = new AnswerTemplateResolver(
        makeIntentService([
          { label: 'product-inquiry', isActive: true, templateZh: '以下是相關規格：{content}', templateEn: 'Here are the specs: {content}' },
        ]) as never,
      );
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'rag+template', content: 'M3 螺絲規格' })],
        'product-inquiry',
        'zh-TW',
      );
      expect(result.strategy).toBe('rag+template');
      expect(result.resolvedContent).toBe('以下是相關規格：M3 螺絲規格');
      expect(result.reason).toContain('rag+template:');
    });

    it('picks templateEn when language is en', () => {
      const resolver = new AnswerTemplateResolver(
        makeIntentService([
          { label: 'product-inquiry', isActive: true, templateZh: '以下是相關規格：{content}', templateEn: 'Here are the specs: {content}' },
        ]) as never,
      );
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'rag+template', content: 'M3 screw spec' })],
        'product-inquiry',
        'en',
      );
      expect(result.strategy).toBe('rag+template');
      expect(result.resolvedContent).toBe('Here are the specs: M3 screw spec');
    });

    it('appends content after template when no {content} placeholder', () => {
      const resolver = new AnswerTemplateResolver(
        makeIntentService([
          { label: 'product-inquiry', isActive: true, templateZh: '感謝您的詢問！', templateEn: 'Thank you for enquiring.' },
        ]) as never,
      );
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'rag+template', content: '詳細規格如下' })],
        'product-inquiry',
        'zh-TW',
      );
      expect(result.strategy).toBe('rag+template');
      expect(result.resolvedContent).toBe('感謝您的詢問！\n\n詳細規格如下');
    });

    it('falls back to raw content when no matching template for intentLabel', () => {
      const resolver = new AnswerTemplateResolver(
        makeIntentService([
          { label: 'other-intent', isActive: true, templateZh: '模板', templateEn: 'template' },
        ]) as never,
      );
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'rag+template', content: '原始內容' })],
        'product-inquiry', // no matching template
        'zh-TW',
      );
      expect(result.strategy).toBe('rag+template');
      expect(result.resolvedContent).toBe('原始內容');
    });

    it('falls back to raw content when intentLabel is null', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService() as never);
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'rag+template', content: '原始內容' })],
        null,
        'zh-TW',
      );
      expect(result.strategy).toBe('rag+template');
      expect(result.resolvedContent).toBe('原始內容');
    });

    it('falls back to raw content when no templates in cache', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService([]) as never);
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'rag+template', content: '原始內容' })],
        'product-inquiry',
        'zh-TW',
      );
      expect(result.strategy).toBe('rag+template');
      expect(result.resolvedContent).toBe('原始內容');
    });

    it('skips isActive=false templates and falls back to raw content', () => {
      const resolver = new AnswerTemplateResolver(
        makeIntentService([
          { label: 'product-inquiry', isActive: false, templateZh: '停用模板', templateEn: 'disabled template' },
        ]) as never,
      );
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'rag+template', content: '原始內容' })],
        'product-inquiry',
        'zh-TW',
      );
      expect(result.resolvedContent).toBe('原始內容');
    });

    it('is deterministic — same inputs produce identical output', () => {
      const resolver = new AnswerTemplateResolver(
        makeIntentService([
          { label: 'pricing-inquiry', isActive: true, templateZh: '價格：{content}', templateEn: 'Price: {content}' },
        ]) as never,
      );
      const results = [
        resolver.resolve([makeRetrievalResult({ answerType: 'rag+template', content: '100 元' })], 'pricing-inquiry', 'zh-TW'),
        resolver.resolve([makeRetrievalResult({ answerType: 'rag+template', content: '100 元' })], 'pricing-inquiry', 'zh-TW'),
      ];
      expect(results[0].resolvedContent).toBe(results[1].resolvedContent);
    });
  });

  describe('strategy=rag', () => {
    it('returns rag strategy for answerType="rag"', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService() as never);
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'rag' })],
        null,
        'zh-TW',
      );
      expect(result.strategy).toBe('rag');
      expect(result.resolvedContent).toBeUndefined();
      expect(result.reason).toContain('rag:');
    });

    it('returns rag strategy when answerType is undefined (default)', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService() as never);
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: undefined })],
        null,
        'zh-TW',
      );
      expect(result.strategy).toBe('rag');
    });

    it('returns rag strategy for unrecognised answerType value', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService() as never);
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'unknown_future_value' })],
        null,
        'zh-TW',
      );
      expect(result.strategy).toBe('rag');
    });
  });

  describe('strategy=llm', () => {
    it('returns llm strategy for answerType="llm"', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService() as never);
      const result = resolver.resolve(
        [makeRetrievalResult({ answerType: 'llm' })],
        null,
        'zh-TW',
      );
      expect(result.strategy).toBe('llm');
      expect(result.resolvedContent).toBeUndefined();
    });

    it('returns llm strategy with no_rag_results reason when ragResults is empty', () => {
      const resolver = new AnswerTemplateResolver(makeIntentService() as never);
      const result = resolver.resolve([], null, 'zh-TW');
      expect(result.strategy).toBe('llm');
      expect(result.reason).toBe('no_rag_results');
    });
  });

  // ── LLM bypass guard ──────────────────────────────────────────────────

  it('does NOT call intentService for template strategy (no need for template lookup)', () => {
    const mockIntentService = makeIntentService();
    const resolver = new AnswerTemplateResolver(mockIntentService as never);
    resolver.resolve([makeRetrievalResult({ answerType: 'template' })], 'product-inquiry', 'zh-TW');
    expect(mockIntentService.getCachedTemplates).not.toHaveBeenCalled();
  });

  it('does NOT call intentService for rag strategy', () => {
    const mockIntentService = makeIntentService();
    const resolver = new AnswerTemplateResolver(mockIntentService as never);
    resolver.resolve([makeRetrievalResult({ answerType: 'rag' })], 'product-inquiry', 'zh-TW');
    expect(mockIntentService.getCachedTemplates).not.toHaveBeenCalled();
  });
});
