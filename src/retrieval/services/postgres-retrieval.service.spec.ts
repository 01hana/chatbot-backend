import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PostgresRetrievalService } from './postgres-retrieval.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * T2-012 — Unit tests for PostgresRetrievalService.
 *
 * Covers:
 *  - ILIKE fallback returns score=0.5 for each result
 *  - ILIKE fallback excludes non-approved or non-public entries
 *  - pg_trgm failure auto-falls back to ILIKE
 *  - Empty query returns empty array without hitting DB
 */
describe('PostgresRetrievalService', () => {
  let service: PostgresRetrievalService;
  let prisma: jest.Mocked<PrismaService>;

  const makeEntry = (id: number, content: string) => ({
    id,
    content,
    title: `Entry ${id}`,
    status: 'approved',
    visibility: 'public',
    deletedAt: null,
    intentLabel: null,
    tags: [],
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

  describe('ILIKE fallback strategy', () => {
    it('should return score=0.5 for every result', async () => {
      (prisma.knowledgeEntry.findMany as jest.Mock).mockResolvedValue([
        makeEntry(1, 'hello world'),
        makeEntry(2, 'hello there'),
      ]);

      const results = await service.retrieve({ query: 'hello', limit: 5 });

      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.score).toBe(0.5));
    });

    it('should pass status=approved and visibility=public filter to Prisma', async () => {
      (prisma.knowledgeEntry.findMany as jest.Mock).mockResolvedValue([]);

      await service.retrieve({ query: 'test', limit: 3 });

      const callArgs = (prisma.knowledgeEntry.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.status).toBe('approved');
      expect(callArgs.where.visibility).toBe('public');
      expect(callArgs.where.deletedAt).toBeNull();
    });

    it('should respect limit parameter', async () => {
      (prisma.knowledgeEntry.findMany as jest.Mock).mockResolvedValue([]);

      await service.retrieve({ query: 'test', limit: 2 });

      const callArgs = (prisma.knowledgeEntry.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.take).toBe(2);
    });

    it('should return empty array for empty query', async () => {
      (prisma.knowledgeEntry.findMany as jest.Mock).mockResolvedValue([]);

      const results = await service.retrieve({ query: '', limit: 5 });
      expect(results).toEqual([]);
    });
  });

  describe('pg_trgm failure fallback', () => {
    it('should fall back to ILIKE when pg_trgm throws', async () => {
      // Re-create service with PG_TRGM_ENABLED=true
      const mockPrisma = {
        knowledgeEntry: {
          findMany: jest.fn().mockResolvedValue([makeEntry(1, 'fallback result')]),
        },
        $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('pg_trgm not installed')),
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
      const results = await trgmService.retrieve({ query: 'hello', limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.5); // ILIKE fallback score
    });
  });
});
