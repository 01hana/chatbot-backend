import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminKnowledgeService } from './admin-knowledge.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
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

    const module = await Test.createTestingModule({
      providers: [
        AdminKnowledgeService,
        { provide: KnowledgeService, useValue: mockKnowledgeService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get(AdminKnowledgeService);
    knowledgeService = module.get(KnowledgeService);
    auditService = module.get(AuditService);
  });

  // ─── list ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('should return paginated data and meta', async () => {
      const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2 })];
      knowledgeService.findFiltered.mockResolvedValueOnce({ items: entries, total: 2 });

      const result = await service.list({ page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(2);
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
      knowledgeService.findDistinctCategories.mockResolvedValueOnce([]);

      const result = await service.getFilters();

      expect(result.status).toEqual([
        { label: '草稿', value: 'draft' },
        { label: '已發佈', value: 'published' },
        { label: '已封存', value: 'archived' },
      ]);
    });

    it('should return category options with Chinese labels for known categories', async () => {
      knowledgeService.findDistinctCategories.mockResolvedValueOnce([
        'faq-general',
        'product-spec',
        'selection-guide',
      ]);

      const result = await service.getFilters();

      expect(knowledgeService.findDistinctCategories).toHaveBeenCalledTimes(1);
      expect(result.category).toEqual([
        { label: '常見問題', value: 'faq-general' },
        { label: '產品規格', value: 'product-spec' },
        { label: '選型指南', value: 'selection-guide' },
      ]);
    });

    it('should fall back to the raw category value for unknown categories', async () => {
      knowledgeService.findDistinctCategories.mockResolvedValueOnce(['custom-category']);

      const result = await service.getFilters();

      expect(result.category).toEqual([{ label: 'custom-category', value: 'custom-category' }]);
    });
  });

  // ─── getOne ───────────────────────────────────────────────────────────────

  describe('getOne()', () => {
    it('should return the entry when found', async () => {
      const entry = makeEntry({ id: 42, title: 'Hex Bolt' });
      knowledgeService.findById.mockResolvedValueOnce(entry);

      const result = await service.getOne(42);
      expect(result).toEqual(entry);
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

      await service.create({ title: 'Test', content: 'Content' });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private' }),
      );
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
          tags: ['wire', '線材'],
          intentLabel: 'product-inquiry',
          aliases: ['Wire'],
        }),
      );
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
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(null);

      await expect(service.update(99, { title: 'X' })).rejects.toThrow(NotFoundException);
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

    it('should not pass status to updateWithVersionSnapshot (status is controlled by publish/archive only)', async () => {
      const updated = makeEntry({ id: 1, version: 2, status: 'draft' });
      knowledgeService.updateWithVersionSnapshot.mockResolvedValueOnce(updated);

      await service.update(1, { title: 'Title' });

      const [[, patchArg]] = knowledgeService.updateWithVersionSnapshot.mock.calls as [
        [number, Record<string, unknown>],
      ];
      expect(patchArg).not.toHaveProperty('status');
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
      const published = makeEntry({ id: 1, status: 'published' });
      const archived = makeEntry({ id: 1, status: 'archived' });
      knowledgeService.findById.mockResolvedValueOnce(published);
      knowledgeService.update.mockResolvedValueOnce(archived);

      const result = await service.archive(1);

      expect(knowledgeService.update).toHaveBeenCalledWith(1, { status: 'archived' });
      expect(result.status).toBe('archived');
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
