import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { KnowledgeCategory } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeCategoryRepository } from './knowledge-category.repository';

function makeCategory(overrides: Partial<KnowledgeCategory> = {}): KnowledgeCategory {
  return {
    id: 1,
    key: 'product-spec',
    label: '產品規格',
    description: '產品規格、尺寸、材質、型號等知識',
    defaultIntentLabel: 'product-inquiry',
    isActive: true,
    sortOrder: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('KnowledgeCategoryRepository', () => {
  let repository: KnowledgeCategoryRepository;
  let mockFindMany: jest.MockedFunction<(...args: unknown[]) => Promise<KnowledgeCategory[]>>;
  let mockFindUnique: jest.MockedFunction<(...args: unknown[]) => Promise<KnowledgeCategory | null>>;
  let mockFindFirst: jest.MockedFunction<(...args: unknown[]) => Promise<KnowledgeCategory | null>>;
  let mockCreate: jest.MockedFunction<(...args: unknown[]) => Promise<KnowledgeCategory>>;
  let mockUpdate: jest.MockedFunction<(...args: unknown[]) => Promise<KnowledgeCategory>>;

  beforeEach(() => {
    mockFindMany = jest.fn<() => Promise<KnowledgeCategory[]>>();
    mockFindUnique = jest.fn<() => Promise<KnowledgeCategory | null>>();
    mockFindFirst = jest.fn<() => Promise<KnowledgeCategory | null>>();
    mockCreate = jest.fn<() => Promise<KnowledgeCategory>>();
    mockUpdate = jest.fn<() => Promise<KnowledgeCategory>>();

    const prisma = {
      knowledgeCategory: {
        findMany: mockFindMany,
        findUnique: mockFindUnique,
        findFirst: mockFindFirst,
        create: mockCreate,
        update: mockUpdate,
      },
    } as unknown as PrismaService;

    repository = new KnowledgeCategoryRepository(prisma);
  });

  describe('findActiveOptions()', () => {
    it('queries active non-deleted categories ordered by sortOrder then label', async () => {
      mockFindMany.mockResolvedValue([]);

      await repository.findActiveOptions();

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      });
    });

    it('maps categories to option VMs including description and defaultIntentLabel', async () => {
      mockFindMany.mockResolvedValue([
        makeCategory({
          key: 'faq-general',
          label: '常見問題',
          description: '一般 FAQ 類知識',
          defaultIntentLabel: 'general-faq',
          sortOrder: 10,
        }),
        makeCategory(),
      ]);

      const result = await repository.findActiveOptions();

      expect(result).toEqual([
        {
          label: '常見問題',
          value: 'faq-general',
          description: '一般 FAQ 類知識',
          defaultIntentLabel: 'general-faq',
        },
        {
          label: '產品規格',
          value: 'product-spec',
          description: '產品規格、尺寸、材質、型號等知識',
          defaultIntentLabel: 'product-inquiry',
        },
      ]);
    });
  });

  describe('findByKey()', () => {
    it('finds a category by unique key', async () => {
      const category = makeCategory();
      mockFindUnique.mockResolvedValue(category);

      const result = await repository.findByKey('product-spec');

      expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: 'product-spec' } });
      expect(result).toBe(category);
    });
  });

  describe('findActiveByKey()', () => {
    it('finds an active non-deleted category by key', async () => {
      const category = makeCategory();
      mockFindFirst.mockResolvedValue(category);

      const result = await repository.findActiveByKey('product-spec');

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { key: 'product-spec', isActive: true, deletedAt: null },
      });
      expect(result).toBe(category);
    });
  });

  describe('create()', () => {
    it('creates a category with defaults', async () => {
      const category = makeCategory({ sortOrder: 0 });
      mockCreate.mockResolvedValue(category);

      const result = await repository.create({ key: 'product-spec', label: '產品規格' });

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          key: 'product-spec',
          label: '產品規格',
          description: null,
          defaultIntentLabel: null,
          isActive: true,
          sortOrder: 0,
        },
      });
      expect(result).toBe(category);
    });
  });

  describe('update()', () => {
    it('updates a category by key', async () => {
      const category = makeCategory({ label: '新產品規格' });
      mockUpdate.mockResolvedValue(category);

      const result = await repository.update('product-spec', { label: '新產品規格' });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { key: 'product-spec' },
        data: { label: '新產品規格' },
      });
      expect(result).toBe(category);
    });
  });

  describe('softDelete()', () => {
    it('sets deletedAt and isActive=false', async () => {
      const category = makeCategory({ isActive: false, deletedAt: new Date() });
      mockUpdate.mockResolvedValue(category);

      const result = await repository.softDelete('product-spec');

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { key: 'product-spec' },
        data: { isActive: false, deletedAt: expect.any(Date) },
      });
      expect(result).toBe(category);
    });
  });
});
