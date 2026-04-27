import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { KnowledgeRepository } from './knowledge.repository';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeEntry } from '../generated/prisma/client';

/** Minimal KnowledgeEntry factory */
function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 1,
    title: 'O型環選材指南',
    content: '選材應根據使用環境...',
    intentLabel: 'product-inquiry',
    tags: ['o-ring', 'material'],
    aliases: [],
    language: 'zh-TW',
    status: 'approved',
    visibility: 'public',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    sourceKey: null,
    category: null,
    answerType: 'rag',
    templateKey: null,
    faqQuestions: [],
    crossLanguageGroupKey: null,
    structuredAttributes: null,
    ...overrides,
  } as KnowledgeEntry;
}

describe('KnowledgeRepository', () => {
  let repository: KnowledgeRepository;
  let mockFindMany: jest.MockedFunction<(...args: unknown[]) => Promise<KnowledgeEntry[]>>;
  let mockFindUnique: jest.MockedFunction<(...args: unknown[]) => Promise<KnowledgeEntry | null>>;
  let mockCreate: jest.MockedFunction<(...args: unknown[]) => Promise<KnowledgeEntry>>;
  let mockUpdate: jest.MockedFunction<(...args: unknown[]) => Promise<KnowledgeEntry>>;

  beforeEach(() => {
    mockFindMany = jest.fn<() => Promise<KnowledgeEntry[]>>();
    mockFindUnique = jest.fn<() => Promise<KnowledgeEntry | null>>();
    mockCreate = jest.fn<() => Promise<KnowledgeEntry>>();
    mockUpdate = jest.fn<() => Promise<KnowledgeEntry>>();

    const mockPrisma = {
      knowledgeEntry: {
        findMany: mockFindMany,
        findUnique: mockFindUnique,
        create: mockCreate,
        update: mockUpdate,
      },
    } as unknown as PrismaService;

    repository = new KnowledgeRepository(mockPrisma);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findForRetrieval — SECURITY INVARIANT TESTS
  // ──────────────────────────────────────────────────────────────────────────

  describe('findForRetrieval() — enforced security filters', () => {
    it('always passes status="approved" to Prisma regardless of caller input', async () => {
      mockFindMany.mockResolvedValue([makeEntry()]);

      await repository.findForRetrieval({});

      const [callArgs] = (mockFindMany as jest.Mock).mock.calls;
      const whereClause = (callArgs as [{ where: Record<string, unknown> }])[0].where;
      expect(whereClause.status).toBe('approved');
    });

    it('always passes visibility="public" to Prisma regardless of caller input', async () => {
      mockFindMany.mockResolvedValue([makeEntry()]);

      await repository.findForRetrieval({});

      const [callArgs] = (mockFindMany as jest.Mock).mock.calls;
      const whereClause = (callArgs as [{ where: Record<string, unknown> }])[0].where;
      expect(whereClause.visibility).toBe('public');
    });

    it('always passes deletedAt: null to exclude soft-deleted entries', async () => {
      mockFindMany.mockResolvedValue([makeEntry()]);

      await repository.findForRetrieval({});

      const [callArgs] = (mockFindMany as jest.Mock).mock.calls;
      const whereClause = (callArgs as [{ where: Record<string, unknown> }])[0].where;
      expect(whereClause.deletedAt).toBeNull();
    });

    it('still enforces status=approved when intentLabel filter is provided', async () => {
      mockFindMany.mockResolvedValue([makeEntry()]);

      await repository.findForRetrieval({ intentLabel: 'price-inquiry' });

      const [callArgs] = (mockFindMany as jest.Mock).mock.calls;
      const whereClause = (callArgs as [{ where: Record<string, unknown> }])[0].where;
      expect(whereClause.status).toBe('approved');
      expect(whereClause.visibility).toBe('public');
    });

    it('still enforces visibility=public when tags filter is provided', async () => {
      mockFindMany.mockResolvedValue([makeEntry()]);

      await repository.findForRetrieval({ tags: ['o-ring'] });

      const [callArgs] = (mockFindMany as jest.Mock).mock.calls;
      const whereClause = (callArgs as [{ where: Record<string, unknown> }])[0].where;
      expect(whereClause.status).toBe('approved');
      expect(whereClause.visibility).toBe('public');
    });

    it('applies intentLabel filter as an additional constraint', async () => {
      mockFindMany.mockResolvedValue([makeEntry()]);

      await repository.findForRetrieval({ intentLabel: 'product-inquiry' });

      const [callArgs] = (mockFindMany as jest.Mock).mock.calls;
      const whereClause = (callArgs as [{ where: Record<string, unknown> }])[0].where;
      expect(whereClause.intentLabel).toBe('product-inquiry');
    });

    it('applies tags filter using hasEvery', async () => {
      mockFindMany.mockResolvedValue([makeEntry()]);

      await repository.findForRetrieval({ tags: ['o-ring', 'material'] });

      const [callArgs] = (mockFindMany as jest.Mock).mock.calls;
      const whereClause = (callArgs as [{ where: Record<string, unknown> }])[0].where;
      expect(whereClause.tags).toEqual({ hasEvery: ['o-ring', 'material'] });
    });

    it('does not add tags filter when tags array is empty', async () => {
      mockFindMany.mockResolvedValue([makeEntry()]);

      await repository.findForRetrieval({ tags: [] });

      const [callArgs] = (mockFindMany as jest.Mock).mock.calls;
      const whereClause = (callArgs as [{ where: Record<string, unknown> }])[0].where;
      expect(whereClause.tags).toBeUndefined();
    });

    it('applies the limit option', async () => {
      mockFindMany.mockResolvedValue([makeEntry()]);

      await repository.findForRetrieval({ limit: 5 });

      const [callArgs] = (mockFindMany as jest.Mock).mock.calls;
      const options = callArgs as [{ take: number }];
      expect(options[0].take).toBe(5);
    });

    it('defaults limit to 20 when not specified', async () => {
      mockFindMany.mockResolvedValue([]);

      await repository.findForRetrieval({});

      const [callArgs] = (mockFindMany as jest.Mock).mock.calls;
      const options = callArgs as [{ take: number }];
      expect(options[0].take).toBe(20);
    });

    it('returns the array from Prisma unchanged', async () => {
      const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2, title: 'Second entry' })];
      mockFindMany.mockResolvedValue(entries);

      const result = await repository.findForRetrieval({});

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });

    it('returns an empty array when Prisma returns no rows', async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await repository.findForRetrieval({});

      expect(result).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findById
  // ──────────────────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the entry when found', async () => {
      const entry = makeEntry({ id: 42 });
      mockFindUnique.mockResolvedValue(entry);

      const result = await repository.findById(42);

      expect(result).toEqual(entry);
    });

    it('returns null when not found', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await repository.findById(9999);

      expect(result).toBeNull();
    });
  });
});
