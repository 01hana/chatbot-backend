import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminKnowledgeService } from './admin-knowledge.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { KnowledgeEntry } from '../../generated/prisma/client';

/**
 * Unit tests for AdminKnowledgeService.
 *
 * Covers:
 *  - listAll: delegates to KnowledgeService.findAll()
 *  - getOne: returns entry or throws NotFoundException
 *  - create: maps DTO → KnowledgeService.create() with correct defaults
 *  - create: persists language and aliases from DTO
 *  - create: defaults language to 'zh-TW' when omitted
 *  - update: applies partial patch including language and aliases
 *  - update: throws NotFoundException when entry does not exist
 *  - remove: calls softDelete and throws NotFoundException when not found
 */
describe('AdminKnowledgeService', () => {
  let service: AdminKnowledgeService;
  let knowledgeService: jest.Mocked<KnowledgeService>;

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

  beforeEach(async () => {
    const mockKnowledgeService: Partial<jest.Mocked<KnowledgeService>> = {
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      findByCategory: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        AdminKnowledgeService,
        { provide: KnowledgeService, useValue: mockKnowledgeService },
      ],
    }).compile();

    service = module.get(AdminKnowledgeService);
    knowledgeService = module.get(KnowledgeService) as jest.Mocked<KnowledgeService>;
  });

  // ─── listAll ──────────────────────────────────────────────────────────────

  describe('listAll()', () => {
    it('should delegate to KnowledgeService.findAll()', async () => {
      const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2 })];
      knowledgeService.findAll.mockResolvedValueOnce(entries);

      const result = await service.listAll();

      expect(result).toEqual(entries);
      expect(knowledgeService.findAll).toHaveBeenCalledTimes(1);
    });

    it('should return all entries regardless of status or visibility', async () => {
      const entries = [
        makeEntry({ status: 'draft', visibility: 'private' }),
        makeEntry({ status: 'approved', visibility: 'public' }),
        makeEntry({ status: 'archived', visibility: 'private' }),
      ];
      knowledgeService.findAll.mockResolvedValueOnce(entries);

      const result = await service.listAll();
      expect(result).toHaveLength(3);
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

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('should create entry with correct language and aliases from DTO', async () => {
      const entry = makeEntry({ language: 'en', aliases: ['What bolts do you offer?'] });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({
        title: 'Hex Bolt',
        content: 'Hex bolt description',
        language: 'en',
        aliases: ['What bolts do you offer?'],
      });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          language: 'en',
          aliases: ['What bolts do you offer?'],
        }),
      );
    });

    it('should default language to "zh-TW" when not provided', async () => {
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

    it('should always set status=draft and visibility=private', async () => {
      const entry = makeEntry();
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({ title: 'Test', content: 'Content' });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft', visibility: 'private' }),
      );
    });

    it('should pass tags and intentLabel from DTO', async () => {
      const entry = makeEntry({ tags: ['wire', '線材'], intentLabel: 'product-inquiry' });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({
        title: 'Wire',
        content: 'Wire overview',
        tags: ['wire', '線材'],
        intentLabel: 'product-inquiry',
      });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['wire', '線材'],
          intentLabel: 'product-inquiry',
        }),
      );
    });

    it('should pass sourceKey, category, and answerType from DTO', async () => {
      const entry = makeEntry({ sourceKey: 'bolt-hex', category: 'product-spec', answerType: 'rag' });
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

    it('should default sourceKey to null when not provided', async () => {
      const entry = makeEntry({ sourceKey: null });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({ title: 'Wire', content: 'Wire overview' });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ sourceKey: null }),
      );
    });

    it('should default answerType to \'rag\' when not provided', async () => {
      const entry = makeEntry({ answerType: 'rag' });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({ title: 'Wire', content: 'Wire overview' });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ answerType: 'rag' }),
      );
    });

    it('should pass templateKey and faqQuestions from DTO', async () => {
      const entry = makeEntry({ templateKey: 'tpl-001', faqQuestions: ['What bolts do you offer?'] });
      knowledgeService.create.mockResolvedValueOnce(entry);

      await service.create({
        title: 'Hex Bolt',
        content: 'Hex bolt description',
        templateKey: 'tpl-001',
        faqQuestions: ['What bolts do you offer?'],
      });

      expect(knowledgeService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          templateKey: 'tpl-001',
          faqQuestions: ['What bolts do you offer?'],
        }),
      );
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('should update language when provided', async () => {
      const updated = makeEntry({ language: 'en' });
      knowledgeService.update.mockResolvedValueOnce(updated);

      await service.update(1, { language: 'en' });

      expect(knowledgeService.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ language: 'en' }),
      );
    });

    it('should update aliases when provided', async () => {
      const updated = makeEntry({ aliases: ['What screws do you have?'] });
      knowledgeService.update.mockResolvedValueOnce(updated);

      await service.update(1, { aliases: ['What screws do you have?'] });

      expect(knowledgeService.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ aliases: ['What screws do you have?'] }),
      );
    });

    it('should not include undefined fields in the patch', async () => {
      const updated = makeEntry({ title: 'New Title' });
      knowledgeService.update.mockResolvedValueOnce(updated);

      await service.update(1, { title: 'New Title' });

      const patchArg: Record<string, unknown> = (knowledgeService.update as jest.Mock).mock.calls[0][1];
      expect(patchArg).not.toHaveProperty('language');
      expect(patchArg).not.toHaveProperty('aliases');
    });

    it('should throw NotFoundException when entry does not exist', async () => {
      knowledgeService.update.mockResolvedValueOnce(null);

      await expect(service.update(99, { title: 'New' })).rejects.toThrow(NotFoundException);
    });

    it('should pass sourceKey and category in patch', async () => {
      const updated = makeEntry({ sourceKey: 'bolt-hex', category: 'product-spec' });
      knowledgeService.update.mockResolvedValueOnce(updated);

      await service.update(1, { sourceKey: 'bolt-hex', category: 'product-spec' });

      expect(knowledgeService.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ sourceKey: 'bolt-hex', category: 'product-spec' }),
      );
    });

    it('should pass answerType, templateKey, faqQuestions, crossLanguageGroupKey in patch', async () => {
      const updated = makeEntry({
        answerType: 'rag+template',
        templateKey: 'tpl-002',
        faqQuestions: ['Any bolt questions?'],
        crossLanguageGroupKey: 'bolt-hex-group',
      });
      knowledgeService.update.mockResolvedValueOnce(updated);

      await service.update(1, {
        answerType: 'rag+template',
        templateKey: 'tpl-002',
        faqQuestions: ['Any bolt questions?'],
        crossLanguageGroupKey: 'bolt-hex-group',
      });

      expect(knowledgeService.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          answerType: 'rag+template',
          templateKey: 'tpl-002',
          faqQuestions: ['Any bolt questions?'],
          crossLanguageGroupKey: 'bolt-hex-group',
        }),
      );
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('should call softDelete with the given id', async () => {
      knowledgeService.softDelete.mockResolvedValueOnce(true);

      await service.remove(5);

      expect(knowledgeService.softDelete).toHaveBeenCalledWith(5);
    });

    it('should throw NotFoundException when entry does not exist', async () => {
      knowledgeService.softDelete.mockResolvedValueOnce(false);

      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });
  });
  // ─── findByCategory ────────────────────────────────────────────────────────────────

  describe('findByCategory()', () => {
    it('should return entries for the given category', async () => {
      const entries = [
        makeEntry({ id: 1, category: 'product-spec' }),
        makeEntry({ id: 2, category: 'product-spec' }),
      ];
      knowledgeService.findByCategory.mockResolvedValueOnce(entries);

      const result = await service.findByCategory('product-spec');

      expect(result).toEqual(entries);
      expect(knowledgeService.findByCategory).toHaveBeenCalledWith('product-spec');
    });

    it('should return empty array when no entries match the category', async () => {
      knowledgeService.findByCategory.mockResolvedValueOnce([]);

      const result = await service.findByCategory('nonexistent');

      expect(result).toEqual([]);
    });
  });});
