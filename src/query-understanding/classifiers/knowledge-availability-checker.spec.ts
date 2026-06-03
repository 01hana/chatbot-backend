import { KnowledgeAvailabilityChecker } from './knowledge-availability-checker.js';
import { QueryType } from '../types/query-type.enum.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// ── Prisma mock helpers ──────────────────────────────────────────────────────

/**
 * Builds a minimal PrismaService mock.
 *
 * `knowledgeEntry.count` and `knowledgeChunk.count` are independent mocks so
 * each test can configure them independently.
 */
function makePrismaMock(
  entryCount: number | (() => number),
  chunkCount: number | (() => number),
): PrismaService {
  const resolveEntry =
    typeof entryCount === 'function' ? entryCount : () => entryCount;
  const resolveChunk =
    typeof chunkCount === 'function' ? chunkCount : () => chunkCount;

  return {
    knowledgeEntry: {
      count: jest.fn().mockImplementation(() => Promise.resolve(resolveEntry())),
    },
    knowledgeChunk: {
      count: jest.fn().mockImplementation(() => Promise.resolve(resolveChunk())),
    },
  } as unknown as PrismaService;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('KnowledgeAvailabilityChecker', () => {
  // ── Defensive early-returns ──────────────────────────────────────────────

  describe('Unknown / Unsupported guard', () => {
    it('QueryType.Unknown → false without querying DB', async () => {
      const prisma = makePrismaMock(5, 5);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      const result = await checker.hasContentFor(QueryType.Unknown, 'zh-TW');

      expect(result).toBe(false);
      expect(prisma.knowledgeEntry.count).not.toHaveBeenCalled();
      expect(prisma.knowledgeChunk.count).not.toHaveBeenCalled();
    });

    it('QueryType.Unsupported → false without querying DB', async () => {
      const prisma = makePrismaMock(5, 5);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      const result = await checker.hasContentFor(QueryType.Unsupported, 'zh-TW');

      expect(result).toBe(false);
      expect(prisma.knowledgeEntry.count).not.toHaveBeenCalled();
      expect(prisma.knowledgeChunk.count).not.toHaveBeenCalled();
    });
  });

  // ── Dual-source strategy ─────────────────────────────────────────────────

  describe('KnowledgeEntry as primary source', () => {
    it('KnowledgeEntry has published/public/not-deleted match → true', async () => {
      // entryCount > 0 → immediately true, no chunk check needed
      const prisma = makePrismaMock(3, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      const result = await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      expect(result).toBe(true);
    });
  });

  describe('KnowledgeChunk as secondary source', () => {
    it('KnowledgeEntry empty + KnowledgeChunk has content → true', async () => {
      const prisma = makePrismaMock(0, 2);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      const result = await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      expect(result).toBe(true);
    });
  });

  describe('both sources empty', () => {
    it('KnowledgeEntry and KnowledgeChunk both return 0 → false', async () => {
      // Both exact-match pass and fallback (language=undefined) pass return 0
      const prisma = makePrismaMock(0, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      const result = await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      expect(result).toBe(false);
    });
  });

  // ── Cache behaviour ──────────────────────────────────────────────────────

  describe('TTL cache', () => {
    it('cache hit on second call — no repeat DB query', async () => {
      const prisma = makePrismaMock(1, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');
      const callsAfterFirst = (prisma.knowledgeEntry.count as jest.Mock).mock.calls.length;

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');
      const callsAfterSecond = (prisma.knowledgeEntry.count as jest.Mock).mock.calls.length;

      // First call: entry.count called once (entry returned 1, no fallback needed)
      expect(callsAfterFirst).toBe(1);
      // Second call: cache hit — no new DB calls
      expect(callsAfterSecond).toBe(1);
    });

    it('different language keys are cached independently', async () => {
      const prisma = makePrismaMock(1, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');
      const callsAfterFirst = (prisma.knowledgeEntry.count as jest.Mock).mock.calls.length;

      await checker.hasContentFor(QueryType.ProductLookup, 'en');
      const callsAfterSecond = (prisma.knowledgeEntry.count as jest.Mock).mock.calls.length;

      // Second language triggers a new DB query
      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
    });

    it('clearCache() forces re-query on next call', async () => {
      const prisma = makePrismaMock(1, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');
      const callsBefore = (prisma.knowledgeEntry.count as jest.Mock).mock.calls.length;

      checker.clearCache();
      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');
      const callsAfter = (prisma.knowledgeEntry.count as jest.Mock).mock.calls.length;

      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  // ── Security invariants ──────────────────────────────────────────────────

  describe('security invariants in DB query', () => {
    it('always passes status=published to knowledgeEntry.count', async () => {
      const prisma = makePrismaMock(0, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      const calls = (prisma.knowledgeEntry.count as jest.Mock).mock.calls;
      // At least one call (exact language match)
      expect(calls.length).toBeGreaterThan(0);
      // Every call must enforce published status
      for (const [args] of calls) {
        expect(args?.where?.status).toBe('published');
      }
    });

    it('always passes visibility=public to knowledgeEntry.count', async () => {
      const prisma = makePrismaMock(0, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      const calls = (prisma.knowledgeEntry.count as jest.Mock).mock.calls;
      for (const [args] of calls) {
        expect(args?.where?.visibility).toBe('public');
      }
    });

    it('always passes deletedAt=null to knowledgeEntry.count', async () => {
      const prisma = makePrismaMock(0, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      const calls = (prisma.knowledgeEntry.count as jest.Mock).mock.calls;
      for (const [args] of calls) {
        expect(args?.where?.deletedAt).toBeNull();
      }
    });

    it('passes document.status=published to knowledgeChunk.count', async () => {
      const prisma = makePrismaMock(0, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      const calls = (prisma.knowledgeChunk.count as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const [args] of calls) {
        expect(args?.where?.document?.status).toBe('published');
      }
    });

    it('passes document.visibility=public to knowledgeChunk.count', async () => {
      const prisma = makePrismaMock(0, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      const calls = (prisma.knowledgeChunk.count as jest.Mock).mock.calls;
      for (const [args] of calls) {
        expect(args?.where?.document?.visibility).toBe('public');
      }
    });

    it('passes document.deletedAt=null to knowledgeChunk.count', async () => {
      const prisma = makePrismaMock(0, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      const calls = (prisma.knowledgeChunk.count as jest.Mock).mock.calls;
      for (const [args] of calls) {
        expect(args?.where?.document?.deletedAt).toBeNull();
      }
    });
  });

  // ── Language matching ────────────────────────────────────────────────────

  describe('language matching', () => {
    it('passes exact language to knowledgeEntry.count on first attempt', async () => {
      const prisma = makePrismaMock(1, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      const calls = (prisma.knowledgeEntry.count as jest.Mock).mock.calls;
      // First call should include the exact language
      expect(calls[0]?.[0]?.where?.language).toBe('zh-TW');
    });

    it('fallback is triggered when exact language match returns 0', async () => {
      // exact match → 0, fallback (no language) → still 0 to simulate "no content at all"
      const prisma = makePrismaMock(0, 0);
      const checker = new KnowledgeAvailabilityChecker(prisma);

      await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      // Should have called count at least twice: exact + fallback
      const entryCalls = (prisma.knowledgeEntry.count as jest.Mock).mock.calls;
      expect(entryCalls.length).toBeGreaterThanOrEqual(2);

      // The fallback call should NOT include language (language-agnostic)
      const fallbackCall = entryCalls[entryCalls.length - 1];
      expect(fallbackCall?.[0]?.where?.language).toBeUndefined();
    });

    it('fallback with content → true', async () => {
      // First call sequence (exact language): both return 0
      // Second call sequence (fallback, no language): entry returns 1
      let entryCallCount = 0;
      const prisma = {
        knowledgeEntry: {
          count: jest.fn().mockImplementation(() => {
            entryCallCount++;
            // First call: exact-language match → 0 (no content for language)
            // Second call: fallback (no language) → 1 (language-agnostic content exists)
            return Promise.resolve(entryCallCount >= 2 ? 1 : 0);
          }),
        },
        knowledgeChunk: {
          count: jest.fn().mockResolvedValue(0),
        },
      } as unknown as PrismaService;

      const checker = new KnowledgeAvailabilityChecker(prisma);
      const result = await checker.hasContentFor(QueryType.ProductLookup, 'zh-TW');

      expect(result).toBe(true);
    });
  });
});
