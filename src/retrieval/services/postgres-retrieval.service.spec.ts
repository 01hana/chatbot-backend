import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PostgresRetrievalService } from './postgres-retrieval.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RETRIEVAL_SCORING } from '../constants/retrieval-scoring.constants';

/**
 * T2-012 — Unit tests for PostgresRetrievalService.
 *
 * Scoring expectations reference RETRIEVAL_SCORING constants so that
 * changing a weight only requires updating the constants file.
 *
 * Covers:
 *  - normalizeQuery: strips question starters, punctuation, full-width chars
 *  - ILIKE strategy: title → ILIKE_TITLE_SCORE, aliases → ILIKE_ALIAS_SCORE, tags → ILIKE_TAG_SCORE, content → ILIKE_CONTENT_SCORE
 *  - ILIKE strategy: uses $queryRawUnsafe (not findMany) with title+aliases+content+tags
 *  - ILIKE strategy: empty / whitespace query returns [] without DB call
 *  - pg_trgm failure auto-falls back to ILIKE
 *  - Query normalization applied before DB call (請問密封件 → 密封件)
 *  - Language-first retrieval and cross-language fallback
 *  - Application-layer reranking with title / alias term bonuses
 */
describe('PostgresRetrievalService', () => {
  let service: PostgresRetrievalService;
  let prisma: jest.Mocked<PrismaService>;

  const makeEntry = (id: number, overrides: Partial<{
    title: string; content: string; tags: string[]; aliases: string[];
  }> = {}) => ({
    id,
    content: overrides.content ?? `Content for entry ${id}`,
    title: overrides.title ?? `Entry ${id}`,
    status: 'approved',
    visibility: 'public',
    deletedAt: null,
    intentLabel: null,
    tags: overrides.tags ?? [],
    aliases: overrides.aliases ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
    authorId: null,
    slug: `entry-${id}`,
    sourceUrl: null,
    language: 'zh-TW',
    version: 1,
  });

  beforeEach(async () => {
    const mockPrisma = {
      knowledgeEntry: {
        findMany: jest.fn(),
      },
      $queryRawUnsafe: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PostgresRetrievalService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('false') }, // ILIKE mode
        },
      ],
    }).compile();

    service = module.get(PostgresRetrievalService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
  });

  // ─── normalizeQuery (static) ──────────────────────────────────────────────

  describe('normalizeQuery (static)', () => {
    it('should strip 請問 prefix', () => {
      expect(PostgresRetrievalService.normalizeQuery('請問密封件怎麼訂製？')).toBe('密封件怎麼訂製');
    });

    it('should strip 想問 prefix', () => {
      expect(PostgresRetrievalService.normalizeQuery('想問一下產品規格')).toBe('產品規格');
    });

    it('should strip trailing punctuation', () => {
      expect(PostgresRetrievalService.normalizeQuery('產品規格？')).toBe('產品規格');
    });

    it('should convert full-width ASCII to half-width', () => {
      expect(PostgresRetrievalService.normalizeQuery('ＡＢＣ１２３')).toBe('ABC123');
    });

    it('should return unchanged plain query', () => {
      expect(PostgresRetrievalService.normalizeQuery('客製化密封件訂製流程')).toBe('客製化密封件訂製流程');
    });

    it('should return empty string for empty input', () => {
      expect(PostgresRetrievalService.normalizeQuery('')).toBe('');
    });

    it('should collapse internal whitespace', () => {
      expect(PostgresRetrievalService.normalizeQuery('密封  件   規格')).toBe('密封 件 規格');
    });
  });

  // ─── ILIKE strategy (raw SQL) ─────────────────────────────────────────────

  describe('ILIKE strategy (raw SQL, title + content + tags)', () => {
    it('should return score=0.8 for title-matching entry', async () => {
      const row = { ...makeEntry(1, { title: '密封件規格' }), score: '0.8' };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: '密封件', limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBeGreaterThanOrEqual(0.8);
    });

    it('should return score=0.5 for content-matching entry', async () => {
      const row = { ...makeEntry(2, { content: '本產品使用高品質橡膠製成' }), score: '0.5' };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: '橡膠', limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.5);
    });

    it('should return score=0.4 for tags-matching entry', async () => {
      const row = { ...makeEntry(3, { tags: ['seals', 'custom'] }), score: '0.4' };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: 'seals', limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.4);
    });

    it('should use $queryRawUnsafe and NOT prisma.knowledgeEntry.findMany', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      await service.retrieve({ query: 'test', limit: 3 });

      expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
      expect(prisma.knowledgeEntry.findMany).not.toHaveBeenCalled();
    });

    it('should pass limit as the second parameter to $queryRawUnsafe', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      await service.retrieve({ query: 'test', limit: 7 });

      const callParams: unknown[] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      // callParams[0] = sql string, callParams[1] = $1 (query), callParams[2] = $2 (limit)
      expect(callParams[2]).toBe(7);
    });

    it('should return empty array for empty query (no DB call)', async () => {
      const results = await service.retrieve({ query: '', limit: 5 });

      expect(results).toEqual([]);
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should return empty array for whitespace-only query', async () => {
      const results = await service.retrieve({ query: '   ', limit: 5 });

      expect(results).toEqual([]);
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should strip 請問 prefix before querying DB (normalizeQuery applied)', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      await service.retrieve({ query: '請問密封件規格', limit: 5 });

      // The first non-sql param ($1) should be the normalized query, not raw
      const callParams: unknown[] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(callParams[1]).toBe('密封件規格');
    });

    it('should strip extra columns (score) from returned entry', async () => {
      const row = { ...makeEntry(4), score: '0.8' };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: 'entry', limit: 5 });

      expect(results[0].entry).not.toHaveProperty('score');
      expect(results[0].entry).toHaveProperty('id', 4);
    });
  });

  // ─── pg_trgm failure fallback ─────────────────────────────────────────────

  describe('pg_trgm failure fallback', () => {
    it('should fall back to ILIKE when pg_trgm throws', async () => {
      const fallbackRow = { ...makeEntry(1, { title: '密封件規格' }), score: '0.8' };
      const mockPrisma = {
        knowledgeEntry: { findMany: jest.fn() },
        $queryRawUnsafe: jest.fn()
          .mockRejectedValueOnce(new Error('pg_trgm not installed')) // trgm fails
          .mockResolvedValueOnce([fallbackRow]),                      // ILIKE succeeds
      };

      const module = await Test.createTestingModule({
        providers: [
          PostgresRetrievalService,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue('true') }, // trgm mode
          },
        ],
      }).compile();

      const trgmService = module.get(PostgresRetrievalService);
      const results = await trgmService.retrieve({ query: '密封件', limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBeGreaterThanOrEqual(0.8); // ILIKE fallback score for title match
    });
  });

  // ─── Language-first retrieval ─────────────────────────────────────────────

  describe('language-first retrieval', () => {
    it('should return same-language results without isCrossLanguageFallback flag', async () => {
      const row = { ...makeEntry(1, { title: 'Hex Bolt' }), score: '0.8' };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: 'bolt', language: 'en', limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0].isCrossLanguageFallback).toBeUndefined();
    });

    it('should mark results as isCrossLanguageFallback=true when same-language returns empty', async () => {
      const fallbackRow = { ...makeEntry(2, { title: '六角螺栓' }), score: '0.7' };
      // First call (with language filter) returns empty; second call (cross-language) returns result
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([])          // same-language empty
        .mockResolvedValueOnce([fallbackRow]); // cross-language hit

      const results = await service.retrieve({ query: 'bolt', language: 'en', limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0].isCrossLanguageFallback).toBe(true);
    });

    it('should call $queryRawUnsafe twice when same-language returns empty (primary + fallback)', async () => {
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([])   // same-language empty
        .mockResolvedValueOnce([]);  // cross-language also empty

      await service.retrieve({ query: 'bolt', language: 'en', limit: 5 });

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it('should call $queryRawUnsafe only once when same-language returns results', async () => {
      const row = { ...makeEntry(3, { title: 'Flat Washer' }), score: '0.8' };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      await service.retrieve({ query: 'washer', language: 'en', limit: 5 });

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    });

    it('should call $queryRawUnsafe once (no language filter) when language is not provided', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      await service.retrieve({ query: 'bolt', limit: 5 });

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    });

    it('cross-language fallback results should still have status=approved and visibility=public enforced by SQL', async () => {
      // The second call (cross-language) is still the same SQL with approved+public conditions;
      // we verify the SQL string contains both clauses.
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.retrieve({ query: 'test', language: 'en', limit: 3 });

      // Both calls should contain the security conditions
      const calls = (prisma.$queryRawUnsafe as jest.Mock).mock.calls;
      for (const call of calls) {
        const sql: string = call[0] as string;
        expect(sql).toContain("ke.status = 'approved'");
        expect(sql).toContain("ke.visibility = 'public'");
      }
    });
  });

  // ─── aliases scoring (ILIKE) ──────────────────────────────────────────────

  describe('aliases scoring in ILIKE strategy', () => {
    it('should return score=0.90 for title-matching entry', async () => {
      const row = { ...makeEntry(1, { title: '螺絲產品總覽' }), score: '0.90' };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: '螺絲產品', limit: 5 });
      expect(results[0].score).toBeGreaterThanOrEqual(0.9);
    });

    it('should return score=0.85 for aliases-matching entry', async () => {
      const row = {
        ...makeEntry(2, { title: '螺絲產品總覽', aliases: ['螺絲類別有哪些'] }),
        score: '0.85',
      };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: '螺絲類別', limit: 5 });
      expect(results[0].score).toBeGreaterThanOrEqual(0.85);
    });

    it('should return score=0.70 for tags-only match', async () => {
      const row = {
        ...makeEntry(3, { tags: ['catalog', 'download'] }),
        score: '0.70',
      };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: 'catalog', limit: 5 });
      expect(results[0].score).toBeCloseTo(0.7, 1);
    });

    it('should return score=0.50 for content-only match', async () => {
      const row = {
        ...makeEntry(4, { content: 'catalog download instructions here' }),
        score: '0.50',
      };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: 'catalog', limit: 5 });
      expect(results[0].score).toBeCloseTo(0.5, 1);
    });

    it('SQL should search aliases via array_to_string in ILIKE WHERE clause', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      await service.retrieve({ query: '螺絲類別', limit: 5 });

      const sql: string = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][0];
      expect(sql).toContain('array_to_string(ke.aliases');
      expect(sql).toContain(String(RETRIEVAL_SCORING.ILIKE_ALIAS_SCORE));
    });

    it('SQL should include aliases in CASE scoring above tags', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      await service.retrieve({ query: 'test', limit: 5 });

      const sql: string = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][0];
      const aliasScore = String(RETRIEVAL_SCORING.ILIKE_ALIAS_SCORE);
      const tagScore = String(RETRIEVAL_SCORING.ILIKE_TAG_SCORE);
      const aliasIdx = sql.indexOf(aliasScore);
      const tagsIdx = sql.indexOf(tagScore);
      expect(aliasIdx).toBeGreaterThan(-1);
      expect(tagsIdx).toBeGreaterThan(-1);
      expect(aliasIdx).toBeLessThan(tagsIdx);
    });
  });

  // ─── application-layer reranking ─────────────────────────────────────────

  describe('application-layer rerankWithTerms', () => {
    it('should boost entries whose title contains extracted terms', async () => {
      // Entry 1: title matches "Product", entry 2: title matches neither
      const row1 = { ...makeEntry(1, { title: 'Product Catalog Download' }), score: '0.85' };
      const row2 = { ...makeEntry(2, { title: 'Wire Overview' }), score: '0.85' };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row2, row1]);

      // Query: "download product catalog" — extractTerms returns ["download","product","catalog"]
      // row1 (title "Product Catalog Download") matches all 3 terms → gets higher bonus
      const results = await service.retrieve({ query: 'download product catalog', language: 'en', limit: 5 });

      const titles = results.map(r => r.entry.title);
      expect(titles[0]).toBe('Product Catalog Download');
    });

    it('should boost entries whose aliases contain extracted terms', async () => {
      const row1 = {
        ...makeEntry(1, {
          title: '螺絲產品總覽',
          aliases: ['螺絲類別有哪些', '螺絲有哪幾種'],
        }),
        score: '0.70',
      };
      const row2 = {
        ...makeEntry(2, { title: '線材產品總覽', aliases: [] }),
        score: '0.72',
      };
      // row2 has slightly higher raw score, but row1's aliases match the query terms
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row2, row1]);

      const results = await service.retrieve({ query: '螺絲類別', language: 'zh-TW', limit: 5 });

      // row1 should be boosted above row2 due to alias term matches
      expect(results[0].entry.title).toBe('螺絲產品總覽');
    });

    it('should not boost entries that have no term overlap', async () => {
      const row = { ...makeEntry(1, { title: '毫無相關條目', aliases: [] }), score: '0.50' };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: '螺絲類別', language: 'zh-TW', limit: 5 });

      // Score should remain at 0.50 with no bonus
      expect(results[0].score).toBeCloseTo(0.50, 2);
    });

    it('should cap reranked score at 1.0', async () => {
      const row = {
        ...makeEntry(1, {
          title: 'download product catalog brochure',
          aliases: ['download product catalog'],
        }),
        score: '0.95',
      };
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([row]);

      const results = await service.retrieve({ query: 'download product catalog', language: 'en', limit: 5 });

      expect(results[0].score).toBeLessThanOrEqual(1.0);
    });
  });

  // ─── normalizeQuery: enhanced rules ──────────────────────────────────────

  describe('normalizeQuery (static) — enhanced rules', () => {
    it('should strip 如何 prefix from Chinese query', () => {
      expect(PostgresRetrievalService.normalizeQuery('如何下載型錄', 'zh-TW')).toBe('下載型錄');
    });

    it('should strip 怎麼 prefix from Chinese query', () => {
      expect(PostgresRetrievalService.normalizeQuery('怎麼聯絡你們', 'zh-TW')).toBe('聯絡你們');
    });

    it('should strip 可以...嗎 from Chinese query', () => {
      expect(PostgresRetrievalService.normalizeQuery('可以下載產品目錄嗎', 'zh-TW')).toBe('下載產品目錄');
    });

    it('should strip 有哪些 trailing particle from Chinese query', () => {
      expect(PostgresRetrievalService.normalizeQuery('螺絲類別有哪些', 'zh-TW')).toBe('螺絲類別');
    });

    it('should strip "How can I" prefix from English query', () => {
      const result = PostgresRetrievalService.normalizeQuery('How can I download the product catalog?', 'en');
      expect(result).toBe('download the product catalog');
    });

    it('should strip "What " prefix from English query', () => {
      const result = PostgresRetrievalService.normalizeQuery('What screw categories do you offer?', 'en');
      expect(result).toBe('screw categories');
    });

    it('should strip "How do I" prefix from English query', () => {
      const result = PostgresRetrievalService.normalizeQuery('How do I request a quote?', 'en');
      expect(result).toBe('request a quote');
    });
  });
});
