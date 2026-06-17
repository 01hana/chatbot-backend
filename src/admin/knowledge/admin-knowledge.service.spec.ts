import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminKnowledgeService } from './admin-knowledge.service';
import { KnowledgeClassificationService } from '../../knowledge/knowledge-classification.service';
import { KnowledgeCategoryService } from '../../knowledge-category/knowledge-category.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { IntentService } from '../../intent/intent.service';
import { AuditService } from '../../audit/audit.service';
import { KnowledgeEntry, KnowledgeVersion } from '../../generated/prisma/client';

/**
 * Unit tests for AdminKnowledgeService.
 *
 * Covers:
 *  - list: pagination, filters, sort params, defaults
 *  - getFilters: status and category table filter options
 *  - getOne: found / not found
 *  - getOneWithVersions: found with versions / not found
 *  - create: defaults (status=draft, version=1, visibility=private), provided visibility, audit event
 *  - update: calls updateWithVersionSnapshot, 404 when missing, audit event
 *  - publish: draft→published, published no-op, archived→published, 404, audit event
 *  - archive: published→archived, draft→archived, archived no-op, 404, audit event
 *  - remove: softDelete / 404
 *  - findByCategory: delegates correctly
 */

// ─── Factories ────────────────────────────────────────────────────────────────

const makeEntry = (overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  id: 1,
  title: 'Test Entry',
  content: 'Test content',
  intentLabel: null,
  tags: [],
  aliases: [],
  language: 'zh-TW',
  status: 'draft',
  visibility: 'private',
  version: 1,
  sourceKey: null,
  category: null,
  answerType: 'rag',
  templateKey: null,
  faqQuestions: [],
  crossLanguageGroupKey: null,
  structuredAttributes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const makeVersion = (overrides: Partial<KnowledgeVersion> = {}): KnowledgeVersion => ({
  id: 10,
  knowledgeEntryId: 1,
  versionNumber: 1,
  contentSnapshot: '{}',
  createdAt: new Date(),
  ...overrides,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminKnowledgeService', () => {
  let service: AdminKnowledgeService;
  let knowledgeService: jest.Mocked<KnowledgeService>;
  let knowledgeCategoryService: jest.Mocked<KnowledgeCategoryService>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const mockKnowledgeService: Partial<jest.Mocked<KnowledgeService>> = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByIdWithVersions: jest.fn(),
      findFiltered: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateWithVersionSnapshot: jest.fn(),
      softDelete: jest.fn(),
      findByCategory: jest.fn(),
      findDistinctCategories: jest.fn(),
    };

    const mockAuditService: Partial<jest.Mocked<AuditService>> = {
      log: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const mockKnowledgeCategoryService: Partial<jest.Mocked<KnowledgeCategoryService>> = {
      findActiveOptions: jest.fn(),
      findByKey: jest.fn(),
      findActiveByKey: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      assertActiveCategory: jest.fn(),
      assertDefaultIntentLabel: jest.fn(),
      resolveDefaultIntentLabel: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        AdminKnowledgeService,
        KnowledgeClassificationService,
        { provide: KnowledgeService, useValue: mockKnowledgeService },
        { provide: KnowledgeCategoryService, useValue: mockKnowledgeCategoryService },
        {
          provide: IntentService,
          useValue: {
            getCachedTemplates: jest.fn().mockReturnValue([
              { title: 'product-inquiry', isActive: true },
              { title: 'product-spec', isActive: true },
              { title: 'general-faq', isActive: true },
              { title: 'price-inquiry', isActive: true },
            ]),
          },
        },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get(AdminKnowledgeService);
    knowledgeService = module.get(KnowledgeService);
    knowledgeCategoryService = module.get(KnowledgeCategoryService);
    auditService = module.get(AuditService);
    knowledgeService.findById.mockResolvedValue(makeEntry());
    knowledgeCategoryService.findActiveOptions.mockResolvedValue([]);
    knowledgeCategoryService.resolveDefaultIntentLabel.mockImplementation(async category => {
      if (category === 'product-spec') return 'product-inquiry';
      if (category === 'faq-general' || category === 'faq') return 'general-faq';
      if (category === 'unknown-category') {
        throw new BadRequestException(`Unknown or inactive knowledge category: ${category}`);
      }
      return null;
    });
  });

  // ─── list ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('should return paginated data and meta', async () => {
      const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2 })];
      knowledgeService.findFiltered.mockResolvedValueOnce({ items: entries, total: 2 });

      const result = await service.list({ page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          retrievable: false,
          retrievalBlockReasons: expect.arrayContaining([
            'status_not_published',
            'visibility_not_public',
            'intentLabel_missing',
            'tags_empty',
          ]),
        }),
      );
      expect(result.meta).toEqual({ total: 2, page: 1, pageSize: 20 });
    });

    it('should pass filters to findFiltered', async () => {
      knowledgeService.findFiltered.mockResolvedValueOnce({ items: [], total: 0 });

      await service.list({
        status: 'published',
        visibility: 'public',
        language: 'en',
        keyword: 'bolt',
      });

      expect(knowledgeService.findFiltered).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'published',
          visibility: 'public',
          language: 'en',
          keyword: 'bolt',
        }),
      );
    });

    it('should default page=1 and pageSize=20 when not provided', async () => {
      knowledgeService.findFiltered.mockResolvedValueOnce({ items: [], total: 0 });

      const result = await service.list({});

      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
    });

    it('should pass sortBy and sortOrder to findFiltered', async () => {
      knowledgeService.findFiltered.mockResolvedValueOnce({ items: [], total: 0 });

      await service.list({ sortBy: 'title', sortOrder: 'asc' });

      expect(knowledgeService.findFiltered).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'title', sortOrder: 'asc' }),
      );
    });

    it('should clamp pageSize to 100 when value exceeds 100', async () => {
      knowledgeService.findFiltered.mockResolvedValueOnce({ items: [], total: 0 });

      const result = await service.list({ pageSize: 500 });

      expect(knowledgeService.findFiltered).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 100 }),
      );
      expect(result.meta.pageSize).toBe(100);
    });

    it('should clamp page to minimum 1 when value is below 1', async () => {
      knowledgeService.findFiltered.mockResolvedValueOnce({ items: [], total: 0 });

      const result = await service.list({ page: 0 });

      expect(knowledgeService.findFiltered).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
      );
      expect(result.meta.page).toBe(1);
    });
  });

  // ─── getFilters ──────────────────────────────────────────────────────────

  describe('getFilters()', () => {
    it('should return status options in knowledge status order', async () => {
      const result = await service.getFilters();

      expect(result.status).toEqual([
        { label: '草稿', value: 'draft' },
        { label: '已發佈', value: 'published' },
        { label: '已封存', value: 'archived' },
      ]);
    });

    it('should return category options from KnowledgeCategoryService', async () => {
      knowledgeCategoryService.findActiveOptions.mockResolvedValueOnce([
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

      const result = await service.getFilters();

      expect(knowledgeCategoryService.findActiveOptions).toHaveBeenCalledTimes(1);
      expect(result.category).toEqual([
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

    it('should not use distinct KnowledgeEntry categories for filter options', async () => {
      await service.getFilters();

      expect(knowledgeService.findDistinctCategories).not.toHaveBeenCalled();
    });
  });

  // ─── getOne ───────────────────────────────────────────────────────────────

  describe('getOne()', () => {
    it('should return the entry when found', async () => {
      const entry = makeEntry({ id: 42, title: 'Hex Bolt' });
      knowledgeService.findById.mockResolvedValueOnce(entry);

      const result = await service.getOne(42);
      expect(result).toEqual(expect.objectContaining(entry));
      expect(result.retrievable).toBe(false);
      expect(result.retrievalBlockReasons).toContain('status_not_published');
      expect(knowledgeService.findById).toHaveBeenCalledWith(42);
    });

    it('should throw NotFoundException when entry does not exist', async () => {
      knowledgeService.findById.mockResolvedValueOnce(null);

      await expect(service.getOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getOneWithVersions ───────────────────────────────────────────────────

  describe('getOneWithVersions()', () => {
    it('should return entry with versions', async () => {
      const entry = { ...makeEntry({ id: 1 }), versions: [makeVersion()] };
      knowledgeService.findByIdWithVersions.mockResolvedValueOnce(entry);

      const result = await service.getOneWithVersions(1);
      expect(result.versions).toHaveLength(1);
      expect(result.retrievable).toBe(false);
      expect(result.retrievalBlockReasons).toContain('status_not_published');
    });

    it('should throw NotFoundException when not found', async () => {
      knowledgeService.findByIdWithVersions.mockResolvedValueOnce(null);

      await expect(service.getOneWithVersions(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('should always set status=draft and version=1', async () => {
      const entry = makeEntry({ status: 'draft', version: 1 });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({ title: 'Test', content: 'Content' });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft', version: 1 }),
      );
    });

    it('should default visibility to private when not provided', async () => {
      const entry = makeEntry({ visibility: 'private' });
      knowledgeService.create.mockResolvedValueOnce(entry);

      const result = await service.create({ title: 'Test', content: 'Content' });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private' }),
      );
      expect(result.status).toBe('draft');
      expect(result.visibility).toBe('private');
    });

    it('should use provided visibility (public)', async () => {
      const entry = makeEntry({ visibility: 'public' });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({ title: 'Test', content: 'Content', visibility: 'public' });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'public' }),
      );
    });

    it('should default language to zh-TW when not provided', async () => {
      const entry = makeEntry({ language: 'zh-TW' });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({ title: '六角螺栓', content: '螺栓說明' });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'zh-TW' }),
      );
    });

    it('should default aliases to [] when not provided', async () => {
      const entry = makeEntry({ aliases: [] });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({ title: 'Wire', content: 'Wire overview' });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ aliases: [] }),
      );
    });

    it('should fire audit log event knowledge_created', async () => {
      const entry = makeEntry({ id: 5, sourceKey: 'sk-001', version: 1 });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({ title: 'Test', content: 'Content' });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'knowledge_created' }),
      );
    });

    it('should pass tags, intentLabel, aliases from DTO', async () => {
      const entry = makeEntry({
        tags: ['wire', '線材'],
        intentLabel: 'product-inquiry',
        aliases: ['Wire'],
      });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({
        title: 'Wire',
        content: 'Wire overview',
        tags: ['wire', '線材'],
        intentLabel: 'product-inquiry',
        aliases: ['Wire'],
      });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['wire', '線材', 'Wire', 'product-inquiry']),
          intentLabel: 'product-inquiry',
          aliases: ['Wire'],
        }),
      );
    });

    it('should resolve intentLabel from category when intentLabel is omitted', async () => {
      const entry = makeEntry({ category: 'product-spec', intentLabel: 'product-inquiry' });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({
        title: '產品規格',
        content: '常見的產品規格有「螺絲」、「螺帽」、「螺栓」',
        category: 'product-spec',
      });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'product-spec',
          intentLabel: 'product-inquiry',
        }),
      );
    });

    it('should let explicit intentLabel override category default intentLabel', async () => {
      const entry = makeEntry({ category: 'product-spec', intentLabel: 'price-inquiry' });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({
        title: '報價',
        content: '報價內容',
        category: 'product-spec',
        intentLabel: 'price-inquiry',
      });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'product-spec',
          intentLabel: 'price-inquiry',
        }),
      );
      expect(knowledgeCategoryService.resolveDefaultIntentLabel).not.toHaveBeenCalled();
    });

    it('should generate tags from title, category, intentLabel, and quoted content terms', async () => {
      const entry = makeEntry({
        title: '產品規格',
        category: 'product-spec',
        intentLabel: 'product-inquiry',
      });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({
        title: '產品規格',
        content: '常見的產品規格有「螺絲」、「螺帽」、「螺栓」',
        category: 'product-spec',
      });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining([
            '產品規格',
            'product-spec',
            'product-inquiry',
            '螺絲',
            '螺帽',
            '螺栓',
          ]),
        }),
      );
    });

    it('should merge provided tags with auto-generated tags', async () => {
      const entry = makeEntry({ tags: ['manual-tag', '產品規格', 'product-spec'] });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({
        title: '產品規格',
        content: '常見的產品規格有「螺絲」',
        category: 'product-spec',
        tags: ['manual-tag'],
      });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining([
            'manual-tag',
            '產品規格',
            'product-spec',
            'product-inquiry',
            '螺絲',
          ]),
        }),
      );
    });

    it('should reject unknown categories', async () => {
      await expect(service.create({
        title: 'Unknown',
        content: 'Unknown content',
        category: 'unknown-category',
      })).rejects.toThrow(BadRequestException);

      expect(knowledgeService.create).not.toHaveBeenCalled();
    });

    it('should reject explicitly provided inactive or unknown intentLabel', async () => {
      await expect(
        service.create({
          title: 'Invalid Intent',
          content: 'Content',
          intentLabel: 'inactive-intent',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(knowledgeService.create).not.toHaveBeenCalled();
    });

    it('should pass sourceKey, category, and answerType from DTO', async () => {
      const entry = makeEntry({
        sourceKey: 'bolt-hex',
        category: 'product-spec',
        answerType: 'rag',
      });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({
        title: 'Hex Bolt',
        content: 'Hex bolt description',
        sourceKey: 'bolt-hex',
        category: 'product-spec',
        answerType: 'rag',
      });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceKey: 'bolt-hex',
          category: 'product-spec',
          answerType: 'rag',
        }),
      );
    });
  });

  // ─── update (with version snapshot) ──────────────────────────────────────

  describe('update()', () => {
    it('should call updateWithVersionSnapshot and return updated entry', async () => {
      const updated = makeEntry({ id: 1, title: 'New Title', version: 2, status: 'draft' });
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      const result = await service.update(1, { title: 'New Title' });

      expect(knowledgeService.updateWithVersionSnapshot).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ title: 'New Title' }),
      );
      expect(result.version).toBe(2);
      expect(result.status).toBe('draft');
    });

    it('should throw NotFoundException when entry does not exist', async () => {
      knowledgeService.findById.mockResolvedValueOnce(null);

      await expect(service.update(99, { title: 'X' })).rejects.toThrow(NotFoundException);
      expect(knowledgeService.updateWithVersionSnapshot).not.toHaveBeenCalled();
    });

    it('should fire audit log event knowledge_updated', async () => {
      const updated = makeEntry({ id: 1, version: 2 });
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      await service.update(1, { title: 'Updated' });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'knowledge_updated' }),
      );
    });

    it('should apply partial patch with language and aliases', async () => {
      const updated = makeEntry({
        language: 'en',
        aliases: ['What bolts do you offer?'],
        version: 2,
      });
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      await service.update(1, { language: 'en', aliases: ['What bolts do you offer?'] });

      expect(knowledgeService.updateWithVersionSnapshot).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ language: 'en', aliases: ['What bolts do you offer?'] }),
      );
    });

    it('should update visibility to public through the normal patch endpoint', async () => {
      const updated = makeEntry({ id: 1, visibility: 'public', version: 2 });
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      const result = await service.update(1, { visibility: 'public' });

      expect(knowledgeService.updateWithVersionSnapshot).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ visibility: 'public' }),
      );
      expect(result.visibility).toBe('public');
    });

    it('should not pass status to updateWithVersionSnapshot (status is controlled by publish/archive only)', async () => {
      const updated = makeEntry({ id: 1, version: 2, status: 'draft' });
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      await service.update(1, { title: 'Title' });

      const [[, patchArg]] = knowledgeService.updateWithVersionSnapshot.mock.calls as [
        [number, Record<string, unknown>],
      ];
      expect(patchArg).not.toHaveProperty('status');
    });

    it('should normalize intentLabel and tags using current entry plus patch values', async () => {
      const current = makeEntry({
        id: 1,
        title: 'Old Title',
        content: 'Old content',
        category: 'faq',
        tags: ['manual-current'],
      });
      const updated = makeEntry({
        id: 1,
        title: '產品規格',
        category: 'product-spec',
        intentLabel: 'product-inquiry',
        tags: ['manual-current', '產品規格', 'product-spec', 'product-inquiry', '螺絲'],
        version: 2,
      });
      knowledgeService.findById.mockResolvedValueOnce(current);
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      await service.update(1, {
        title: '產品規格',
        category: 'product-spec',
        content: '常見的產品規格有「螺絲」',
      });

      expect(knowledgeService.updateWithVersionSnapshot).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          title: '產品規格',
          category: 'product-spec',
          content: '常見的產品規格有「螺絲」',
          intentLabel: 'product-inquiry',
          tags: expect.arrayContaining([
            'manual-current',
            '產品規格',
            'product-spec',
            'product-inquiry',
            '螺絲',
          ]),
        }),
      );
    });

    it('should preserve current intentLabel when only title changes', async () => {
      const current = makeEntry({
        id: 1,
        title: '舊標題',
        category: 'custom-category',
        intentLabel: 'product-spec',
        tags: ['manual-current'],
      });
      const updated = makeEntry({
        id: 1,
        title: '新標題',
        category: 'custom-category',
        intentLabel: 'product-spec',
        tags: ['manual-current', '新標題', 'custom-category', 'product-spec'],
        version: 2,
      });
      knowledgeService.findById.mockResolvedValueOnce(current);
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      await service.update(1, { title: '新標題' });

      expect(knowledgeService.updateWithVersionSnapshot).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          title: '新標題',
          intentLabel: 'product-spec',
          tags: expect.arrayContaining(['manual-current', '新標題', 'product-spec']),
        }),
      );
    });

    it('should preserve current intentLabel and include it in tags when only content changes', async () => {
      const current = makeEntry({
        id: 1,
        category: 'custom-category',
        intentLabel: 'product-spec',
        tags: ['manual-current'],
      });
      const updated = makeEntry({
        id: 1,
        category: 'custom-category',
        intentLabel: 'product-spec',
        content: '新內容「螺絲」',
        tags: ['manual-current', 'product-spec', '螺絲'],
        version: 2,
      });
      knowledgeService.findById.mockResolvedValueOnce(current);
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      await service.update(1, { content: '新內容「螺絲」' });

      expect(knowledgeService.updateWithVersionSnapshot).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          content: '新內容「螺絲」',
          intentLabel: 'product-spec',
          tags: expect.arrayContaining(['manual-current', 'product-spec', '螺絲']),
        }),
      );
    });

    it('should recalculate intentLabel when category changes', async () => {
      const current = makeEntry({
        id: 1,
        category: 'faq-general',
        intentLabel: 'general-faq',
      });
      const updated = makeEntry({
        id: 1,
        category: 'product-spec',
        intentLabel: 'product-inquiry',
        version: 2,
      });
      knowledgeService.findById.mockResolvedValueOnce(current);
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      await service.update(1, { category: 'product-spec' });

      expect(knowledgeService.updateWithVersionSnapshot).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          category: 'product-spec',
          intentLabel: 'product-inquiry',
        }),
      );
    });

    it('should let explicit intentLabel override category default on update', async () => {
      const current = makeEntry({
        id: 1,
        category: 'faq-general',
        intentLabel: 'general-faq',
      });
      const updated = makeEntry({
        id: 1,
        category: 'product-spec',
        intentLabel: 'price-inquiry',
        version: 2,
      });
      knowledgeService.findById.mockResolvedValueOnce(current);
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      await service.update(1, { category: 'product-spec', intentLabel: 'price-inquiry' });

      expect(knowledgeService.updateWithVersionSnapshot).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          category: 'product-spec',
          intentLabel: 'price-inquiry',
        }),
      );
    });

    it('should reject unknown category updates', async () => {
      knowledgeService.findById.mockResolvedValueOnce(makeEntry({ id: 1 }));

      await expect(service.update(1, { category: 'unknown-category' })).rejects.toThrow(
        BadRequestException,
      );
      expect(knowledgeService.updateWithVersionSnapshot).not.toHaveBeenCalled();
    });
  });

  // ─── updateVisibility (no version snapshot) ─────────────────────────────

  describe('updateVisibility()', () => {
    it('should update only visibility and return retrievable when published public complete', async () => {
      const current = makeEntry({
        id: 1,
        status: 'published',
        visibility: 'private',
        intentLabel: 'product-spec',
        tags: ['產品規格'],
        title: '產品規格',
        content: '產品規格內容',
        version: 3,
      });
      const updated = makeEntry({ ...current, visibility: 'public' });
      knowledgeService.findById.mockResolvedValueOnce(current);
      knowledgeService.update.mockResolvedValueOnce(updated);

      const result = await service.updateVisibility(1, { visibility: 'public' });

      expect(knowledgeService.update).toHaveBeenCalledWith(1, { visibility: 'public' });
      expect(knowledgeService.updateWithVersionSnapshot).not.toHaveBeenCalled();
      expect(result.visibility).toBe('public');
      expect(result.version).toBe(3);
      expect(result.intentLabel).toBe('product-spec');
      expect(result.tags).toEqual(['產品規格']);
      expect(result.retrievable).toBe(true);
      expect(result.retrievalBlockReasons).toEqual([]);
    });

    it('should keep draft public entries not retrievable', async () => {
      const current = makeEntry({
        id: 1,
        status: 'draft',
        visibility: 'private',
        intentLabel: 'product-spec',
        tags: ['產品規格'],
        title: '產品規格',
        content: '產品規格內容',
      });
      const updated = makeEntry({ ...current, visibility: 'public' });
      knowledgeService.findById.mockResolvedValueOnce(current);
      knowledgeService.update.mockResolvedValueOnce(updated);

      const result = await service.updateVisibility(1, { visibility: 'public' });

      expect(result.visibility).toBe('public');
      expect(result.retrievable).toBe(false);
      expect(result.retrievalBlockReasons).toContain('status_not_published');
    });

    it('should no-op when visibility is unchanged', async () => {
      const current = makeEntry({
        id: 1,
        status: 'published',
        visibility: 'public',
        intentLabel: 'product-spec',
        tags: ['產品規格'],
      });
      knowledgeService.findById.mockResolvedValueOnce(current);

      const result = await service.updateVisibility(1, { visibility: 'public' });

      expect(knowledgeService.update).not.toHaveBeenCalled();
      expect(knowledgeService.updateWithVersionSnapshot).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 1, visibility: 'public' }));
    });

    it('should throw NotFoundException when entry does not exist', async () => {
      knowledgeService.findById.mockResolvedValueOnce(null);

      await expect(service.updateVisibility(99, { visibility: 'public' })).rejects.toThrow(
        NotFoundException,
      );
      expect(knowledgeService.update).not.toHaveBeenCalled();
      expect(knowledgeService.updateWithVersionSnapshot).not.toHaveBeenCalled();
    });

    it('should write knowledge_visibility_updated audit log when visibility changes', async () => {
      const current = makeEntry({
        id: 1,
        sourceKey: 'kb-001',
        status: 'published',
        visibility: 'private',
        version: 7,
      });
      const updated = makeEntry({ ...current, visibility: 'public' });
      knowledgeService.findById.mockResolvedValueOnce(current);
      knowledgeService.update.mockResolvedValueOnce(updated);

      await service.updateVisibility(1, { visibility: 'public' });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'knowledge_visibility_updated',
          eventData: expect.objectContaining({
            id: 1,
            sourceKey: 'kb-001',
            fromVisibility: 'private',
            toVisibility: 'public',
            status: 'published',
            version: 7,
          }),
        }),
      );
    });
  });

  // ─── retrieval state VM ──────────────────────────────────────────────────

  describe('retrieval state fields', () => {
    it('should mark published public complete entries as retrievable', async () => {
      const entry = makeEntry({
        status: 'published',
        visibility: 'public',
        intentLabel: 'product-spec',
        tags: ['產品規格'],
        title: '產品規格',
        content: '產品規格內容',
      });
      knowledgeService.findFiltered.mockResolvedValueOnce({ items: [entry], total: 1 });

      const result = await service.list({});

      expect(result.data[0]).toEqual(
        expect.objectContaining({
          retrievable: true,
          retrievalBlockReasons: [],
        }),
      );
    });

    it.each([
      [
        'published private entries',
        makeEntry({
          status: 'published',
          visibility: 'private',
          intentLabel: 'product-spec',
          tags: ['產品規格'],
        }),
        'visibility_not_public',
      ],
      [
        'draft public entries',
        makeEntry({
          status: 'draft',
          visibility: 'public',
          intentLabel: 'product-spec',
          tags: ['產品規格'],
        }),
        'status_not_published',
      ],
      [
        'entries without intentLabel',
        makeEntry({
          status: 'published',
          visibility: 'public',
          intentLabel: null,
          tags: ['產品規格'],
        }),
        'intentLabel_missing',
      ],
      [
        'entries without tags',
        makeEntry({
          status: 'published',
          visibility: 'public',
          intentLabel: 'product-spec',
          tags: [],
        }),
        'tags_empty',
      ],
      [
        'entries without title',
        makeEntry({
          status: 'published',
          visibility: 'public',
          intentLabel: 'product-spec',
          tags: ['產品規格'],
          title: '   ',
        }),
        'content_empty',
      ],
      [
        'entries without content',
        makeEntry({
          status: 'published',
          visibility: 'public',
          intentLabel: 'product-spec',
          tags: ['產品規格'],
          content: '   ',
        }),
        'content_empty',
      ],
    ])('should block %s', async (_caseName, entry, reason) => {
      knowledgeService.findFiltered.mockResolvedValueOnce({ items: [entry], total: 1 });

      const result = await service.list({});

      expect(result.data[0].retrievable).toBe(false);
      expect(result.data[0].retrievalBlockReasons).toContain(reason);
    });
  });

  // ─── publish ──────────────────────────────────────────────────────────────

  describe('publish()', () => {
    it('should transition draft → published', async () => {
      const draft = makeEntry({ id: 1, status: 'draft' });
      const published = makeEntry({ id: 1, status: 'published' });
      knowledgeService.findById.mockResolvedValueOnce(draft);
      knowledgeService.update.mockResolvedValueOnce(published);

      const result = await service.publish(1);

      expect(knowledgeService.update).toHaveBeenCalledWith(1, { status: 'published' });
      expect(result.status).toBe('published');
    });

    it('should be no-op when already published', async () => {
      const published = makeEntry({ id: 1, status: 'published' });
      knowledgeService.findById.mockResolvedValueOnce(published);

      const result = await service.publish(1);

      expect(knowledgeService.update).not.toHaveBeenCalled();
      expect(result.status).toBe('published');
    });

    it('should transition archived → published', async () => {
      const archived = makeEntry({ id: 1, status: 'archived' });
      const published = makeEntry({ id: 1, status: 'published' });
      knowledgeService.findById.mockResolvedValueOnce(archived);
      knowledgeService.update.mockResolvedValueOnce(published);

      const result = await service.publish(1);

      expect(knowledgeService.update).toHaveBeenCalledWith(1, { status: 'published' });
      expect(result.status).toBe('published');
    });

    it('should throw NotFoundException when entry not found', async () => {
      knowledgeService.findById.mockResolvedValueOnce(null);

      await expect(service.publish(99)).rejects.toThrow(NotFoundException);
    });

    it('should fire audit log knowledge_published', async () => {
      const draft = makeEntry({ id: 1, status: 'draft' });
      const published = makeEntry({ id: 1, status: 'published' });
      knowledgeService.findById.mockResolvedValueOnce(draft);
      knowledgeService.update.mockResolvedValueOnce(published);

      await service.publish(1);

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'knowledge_published',
          eventData: expect.objectContaining({ fromStatus: 'draft', toStatus: 'published' }),
        }),
      );
    });
  });

  // ─── archive ──────────────────────────────────────────────────────────────

  describe('archive()', () => {
    it('should transition published → archived', async () => {
      const published = makeEntry({ id: 1, status: 'published', visibility: 'public' });
      const archived = makeEntry({ id: 1, status: 'archived', visibility: 'public' });
      knowledgeService.findById.mockResolvedValueOnce(published);
      knowledgeService.update.mockResolvedValueOnce(archived);

      const result = await service.archive(1);

      expect(knowledgeService.update).toHaveBeenCalledWith(1, { status: 'archived' });
      expect(result.status).toBe('archived');
      expect(result.visibility).toBe('public');
      expect(result.retrievable).toBe(false);
      expect(result.retrievalBlockReasons).toContain('status_not_published');
    });

    it('should allow draft → archived', async () => {
      const draft = makeEntry({ id: 1, status: 'draft' });
      const archived = makeEntry({ id: 1, status: 'archived' });
      knowledgeService.findById.mockResolvedValueOnce(draft);
      knowledgeService.update.mockResolvedValueOnce(archived);

      const result = await service.archive(1);

      expect(result.status).toBe('archived');
    });

    it('should be no-op when already archived', async () => {
      const archived = makeEntry({ id: 1, status: 'archived' });
      knowledgeService.findById.mockResolvedValueOnce(archived);

      const result = await service.archive(1);

      expect(knowledgeService.update).not.toHaveBeenCalled();
      expect(result.status).toBe('archived');
    });

    it('should throw NotFoundException when entry not found', async () => {
      knowledgeService.findById.mockResolvedValueOnce(null);

      await expect(service.archive(99)).rejects.toThrow(NotFoundException);
    });

    it('should fire audit log knowledge_archived', async () => {
      const published = makeEntry({ id: 1, status: 'published' });
      const archived = makeEntry({ id: 1, status: 'archived' });
      knowledgeService.findById.mockResolvedValueOnce(published);
      knowledgeService.update.mockResolvedValueOnce(archived);

      await service.archive(1);

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'knowledge_archived',
          eventData: expect.objectContaining({ fromStatus: 'published', toStatus: 'archived' }),
        }),
      );
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('should call softDelete and return void', async () => {
      knowledgeService.softDelete.mockResolvedValueOnce(true);

      await expect(service.remove(1)).resolves.toBeUndefined();
      expect(knowledgeService.softDelete).toHaveBeenCalledWith(1);
    });

    it('should throw NotFoundException when entry not found', async () => {
      knowledgeService.softDelete.mockResolvedValueOnce(false);

      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findByCategory ───────────────────────────────────────────────────────

  describe('findByCategory()', () => {
    it('should delegate to knowledgeService.findByCategory()', async () => {
      const entries = [makeEntry({ id: 1, category: 'product-spec' })];
      knowledgeService.findByCategory.mockResolvedValueOnce(entries);

      const result = await service.findByCategory('product-spec');

      expect(result).toEqual(entries);
      expect(knowledgeService.findByCategory).toHaveBeenCalledWith('product-spec');
    });

    it('should return empty array when no entries match', async () => {
      knowledgeService.findByCategory.mockResolvedValueOnce([]);

      const result = await service.findByCategory('nonexistent');

      expect(result).toEqual([]);
    });
  });
});
