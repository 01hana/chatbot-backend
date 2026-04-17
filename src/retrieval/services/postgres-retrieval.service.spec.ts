import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PostgresRetrievalService } from './postgres-retrieval.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * T2-012 — Unit tests for PostgresRetrievalService.
 *
 * Covers:
 *  - normalizeQuery: strips question starters, punctuation, full-width chars
 *  - ILIKE strategy: title match → 0.8, content match → 0.5, tags match → 0.4
 *  - ILIKE strategy: uses $queryRawUnsafe (not findMany) with title+content+tags
 *  - ILIKE strategy: empty / whitespace query returns [] without DB call
 *  - pg_trgm failure auto-falls back to ILIKE
 *  - Query normalization applied before DB call (請問密封件 → 密封件)
 */
describe('PostgresRetrievalService', () => {
  let service: PostgresRetrievalService;
  let prisma: jest.Mocked<PrismaService>;

  const makeEntry = (id: number, overrides: Partial<{
    title: string; content: string; tags: string[];
  }> = {}) => ({
    id,
    content: overrides.content ?? `Content for entry ${id}`,
    title: overrides.title ?? `Entry ${id}`,
    status: 'approved',
    visibility: 'public',
    deletedAt: null,
    intentLabel: null,
    tags: overrides.tags ?? [],
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
      expect(results[0].score).toBe(0.8);
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
      expect(results[0].score).toBe(0.8); // ILIKE fallback score for title match
    });
  });
});
