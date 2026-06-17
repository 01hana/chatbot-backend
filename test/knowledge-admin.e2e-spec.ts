/**
 * knowledge-admin.e2e-spec.ts — T6-010 Knowledge Admin integration tests
 *
 * Tests the full admin knowledge workflow without requiring a real DB.
 * Uses a mocked PrismaService with a NestJS testing module.
 *
 * Covers:
 *  1. create → status=draft / version=1
 *  2. update → KnowledgeVersion snapshot produced / version+1 / status=draft
 *  3. publish draft → published
 *  4. published + public → findForRetrieval() returns it
 *  5. archive published → archived
 *  6. archived entry NOT returned by findForRetrieval()
 *  7. draft entry NOT returned by findForRetrieval()
 *  8. internal / confidential entries NOT returned by findForRetrieval()
 *  9. publish archived → published
 * 10. list pagination and filter
 */
import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminKnowledgeService } from '../src/admin/knowledge/admin-knowledge.service';
import { KnowledgeClassificationService } from '../src/knowledge/knowledge-classification.service';
import { KnowledgeCategoryService } from '../src/knowledge-category/knowledge-category.service';
import { KnowledgeRepository } from '../src/knowledge/knowledge.repository';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import { IntentService } from '../src/intent/intent.service';
import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { KnowledgeEntry, KnowledgeVersion } from '../src/generated/prisma/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let idCounter = 1;
let versionIdCounter = 100;

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: idCounter++,
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
  };
}

// ─── In-memory store for integration-style tests ──────────────────────────────

/**
 * Build a mocked PrismaService that stores entries in memory.
 * This lets us test the full KnowledgeRepository → KnowledgeService → AdminKnowledgeService
 * chain without a real DB.
 */
function buildMemoryPrisma() {
  const entries = new Map<number, KnowledgeEntry>();
  const versions: KnowledgeVersion[] = [];

  const knowledgeEntry = {
    findMany: jest.fn(({ where = {}, orderBy, skip, take }: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
      skip?: number;
      take?: number;
    } = {}) => {
      let results = [...entries.values()];

      // Apply where filters
      if (where['deletedAt'] === null) results = results.filter(e => e.deletedAt === null);
      if (where['status']) results = results.filter(e => e.status === where['status']);
      if (where['visibility']) results = results.filter(e => e.visibility === where['visibility']);
      if (where['language']) results = results.filter(e => e.language === where['language']);
      if (where['intentLabel']) results = results.filter(e => e.intentLabel === where['intentLabel']);
      const tagsFilter = where['tags'] as { hasEvery?: string[] } | undefined;
      if (tagsFilter?.hasEvery) {
        results = results.filter(e =>
          tagsFilter.hasEvery!.every(tag => e.tags.includes(tag)),
        );
      }
      if (where['OR']) {
        // keyword search — not tested in detail here; just return all
      }

      if (skip !== undefined) results = results.slice(skip);
      if (take !== undefined) results = results.slice(0, take);

      return Promise.resolve(results);
    }),

    findUnique: jest.fn(({ where, include }: { where: { id: number }; include?: Record<string, unknown> }) => {
      const entry = entries.get(where.id) ?? null;
      if (!entry) return Promise.resolve(null);
      if (include?.versions) {
        return Promise.resolve({
          ...entry,
          versions: versions.filter(v => v.knowledgeEntryId === entry.id),
        });
      }
      return Promise.resolve(entry);
    }),

    create: jest.fn(({ data }: { data: Partial<KnowledgeEntry> }) => {
      const entry: KnowledgeEntry = {
        id: idCounter++,
        title: data.title ?? '',
        content: data.content ?? '',
        intentLabel: data.intentLabel ?? null,
        tags: (data.tags as string[]) ?? [],
        aliases: (data.aliases as string[]) ?? [],
        language: data.language ?? 'zh-TW',
        status: data.status ?? 'draft',
        visibility: data.visibility ?? 'private',
        version: data.version ?? 1,
        sourceKey: data.sourceKey ?? null,
        category: data.category ?? null,
        answerType: data.answerType ?? 'rag',
        templateKey: data.templateKey ?? null,
        faqQuestions: (data.faqQuestions as string[]) ?? [],
        crossLanguageGroupKey: data.crossLanguageGroupKey ?? null,
        structuredAttributes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      entries.set(entry.id, entry);
      return Promise.resolve(entry);
    }),

    update: jest.fn(({ where, data }: { where: { id: number }; data: Partial<KnowledgeEntry> }) => {
      const existing = entries.get(where.id);
      if (!existing) throw new Error('Record not found');
      const updated = { ...existing, ...data, updatedAt: new Date() };
      entries.set(where.id, updated);
      return Promise.resolve(updated);
    }),

    count: jest.fn(({ where = {} }: { where?: Record<string, unknown> } = {}) => {
      let results = [...entries.values()];
      if (where['deletedAt'] === null) results = results.filter(e => e.deletedAt === null);
      if (where['status']) results = results.filter(e => e.status === where['status']);
      if (where['visibility']) results = results.filter(e => e.visibility === where['visibility']);
      return Promise.resolve(results.length);
    }),
  };

  const knowledgeVersion = {
    create: jest.fn(({ data }: { data: { knowledgeEntryId: number; versionNumber: number; contentSnapshot: string } }) => {
      const version: KnowledgeVersion = {
        id: versionIdCounter++,
        knowledgeEntryId: data.knowledgeEntryId,
        versionNumber: data.versionNumber,
        contentSnapshot: data.contentSnapshot,
        createdAt: new Date(),
      };
      versions.push(version);
      return Promise.resolve(version);
    }),
  };

  // $transaction: run all operations sequentially and return array of results
  const $transaction = jest.fn(async (ops: Array<Promise<unknown>>) => {
    const results: unknown[] = [];
    for (const op of ops) {
      results.push(await op);
    }
    return results;
  });

  return {
    knowledgeEntry,
    knowledgeVersion,
    $transaction,
    _entries: entries,
    _versions: versions,
  };
}

// ─── Test suite ────────────────────────────────────────────────────────────────

describe('Knowledge Admin — integration (mocked Prisma)', () => {
  let module: TestingModule;
  let adminService: AdminKnowledgeService;
  let knowledgeRepository: KnowledgeRepository;
  let mockPrisma: ReturnType<typeof buildMemoryPrisma>;

  beforeEach(async () => {
    idCounter = 1;
    versionIdCounter = 100;
    mockPrisma = buildMemoryPrisma();

    const mockAuditService = {
      log: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    module = await Test.createTestingModule({
      providers: [
        AdminKnowledgeService,
        KnowledgeClassificationService,
        KnowledgeService,
        KnowledgeRepository,
        {
          provide: KnowledgeCategoryService,
          useValue: {
            findActiveOptions: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
            findByKey: jest.fn<() => Promise<unknown | null>>().mockResolvedValue(null),
            findActiveByKey: jest.fn<() => Promise<unknown | null>>().mockResolvedValue(null),
            resolveDefaultIntentLabel: jest.fn(async (category: string) => {
              if (category === 'product-spec') return 'product-inquiry';
              if (category === 'faq-general') return 'general-faq';
              return null;
            }),
          },
        },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: IntentService,
          useValue: {
            getCachedTemplates: jest.fn().mockReturnValue([
              { title: 'product-spec', isActive: true },
              { title: 'general-faq', isActive: true },
              { title: 'product-inquiry', isActive: true },
            ]),
          },
        },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    adminService = module.get(AdminKnowledgeService);
    knowledgeRepository = module.get(KnowledgeRepository);
  });

  // ─── Test 1: create → status=draft / version=1 ───────────────────────────

  it('1. create → status=draft, version=1', async () => {
    const entry = await adminService.create({
      title: 'O-Ring Guide',
      content: 'O-ring selection guide',
      visibility: 'public',
    });

    expect(entry.status).toBe('draft');
    expect(entry.version).toBe(1);
    expect(entry.visibility).toBe('public');
  });

  // ─── Test 2: update → snapshot / version+1 / status=draft ────────────────

  it('2. update → KnowledgeVersion snapshot created, version incremented, status=draft', async () => {
    // Create initial entry
    const created = await adminService.create({ title: 'Original', content: 'Original content' });
    const originalVersion = created.version;

    // Update it
    const updated = await adminService.update(created.id, { title: 'Updated', content: 'New content' });

    expect(updated.version).toBe(originalVersion + 1);
    expect(updated.status).toBe('draft');
    expect(updated.title).toBe('Updated');

    // Verify a KnowledgeVersion snapshot was created
    expect(mockPrisma._versions).toHaveLength(1);
    const snap = mockPrisma._versions[0];
    expect(snap.knowledgeEntryId).toBe(created.id);
    expect(snap.versionNumber).toBe(originalVersion);
    const parsed = JSON.parse(snap.contentSnapshot) as Record<string, unknown>;
    expect(parsed.title).toBe('Original');
    expect(parsed.content).toBe('Original content');
  });

  it('2b. updateVisibility changes visibility without creating a version snapshot', async () => {
    const created = await adminService.create({
      title: 'Visibility only',
      content: 'Visibility content',
      visibility: 'private',
    });

    const updated = await adminService.updateVisibility(created.id, { visibility: 'public' });

    expect(updated.visibility).toBe('public');
    expect(updated.version).toBe(created.version);
    expect(updated.status).toBe('draft');
    expect(updated.retrievable).toBe(false);
    expect(updated.retrievalBlockReasons).toContain('status_not_published');
    expect(mockPrisma._versions).toHaveLength(0);
  });

  // ─── Test 3: publish draft → published ───────────────────────────────────

  it('3. publish draft → published', async () => {
    const created = await adminService.create({ title: 'Entry', content: 'Content' });
    expect(created.status).toBe('draft');

    const published = await adminService.publish(created.id);

    expect(published.status).toBe('published');
  });

  // ─── Test 4: published + public → findForRetrieval returns it ────────────

  it('4. published + public entry is returned by KnowledgeRepository.findForRetrieval()', async () => {
    // Create and publish a public entry
    const entry = await adminService.create({ title: 'Public Entry', content: 'Public content', visibility: 'public' });
    await adminService.publish(entry.id);

    const results = await knowledgeRepository.findForRetrieval({});

    expect(results.some(r => r.id === entry.id)).toBe(true);
  });

  it('4b. product-spec knowledge with generated intentLabel and tags is retrievable', async () => {
    const entry = await adminService.create({
      title: '產品規格',
      category: 'product-spec',
      content: '常見的產品規格有「螺絲」、「螺帽」、「螺栓」',
      visibility: 'public',
    });

    expect(entry.intentLabel).toBe('product-inquiry');
    expect(entry.tags).toEqual(
      expect.arrayContaining([
        '產品規格',
        'product-spec',
        'product-inquiry',
        '螺絲',
        '螺帽',
        '螺栓',
      ]),
    );

    await adminService.publish(entry.id);

    const results = await knowledgeRepository.findForRetrieval({
      intentLabel: 'product-inquiry',
      tags: ['產品規格'],
    });

    expect(results.some(result => result.id === entry.id)).toBe(true);
  });

  // ─── Test 5: archive published → archived ────────────────────────────────

  it('5. archive published → archived', async () => {
    const entry = await adminService.create({ title: 'Entry', content: 'Content' });
    await adminService.publish(entry.id);

    const archived = await adminService.archive(entry.id);

    expect(archived.status).toBe('archived');
  });

  // ─── Test 6: archived NOT in retrieval ───────────────────────────────────

  it('6. archived entry is NOT returned by findForRetrieval()', async () => {
    const entry = await adminService.create({ title: 'Entry', content: 'Content', visibility: 'public' });
    await adminService.publish(entry.id);
    await adminService.archive(entry.id);

    const results = await knowledgeRepository.findForRetrieval({});

    expect(results.some(r => r.id === entry.id)).toBe(false);
  });

  // ─── Test 7: draft NOT in retrieval ──────────────────────────────────────

  it('7. draft entry is NOT returned by findForRetrieval()', async () => {
    const entry = await adminService.create({ title: 'Draft Entry', content: 'Content', visibility: 'public' });
    // Do NOT publish — stays draft

    const results = await knowledgeRepository.findForRetrieval({});

    expect(results.some(r => r.id === entry.id)).toBe(false);
  });

  // ─── Test 8: internal/confidential NOT in retrieval ──────────────────────

  it('8. internal visibility NOT returned by findForRetrieval()', async () => {
    const entry = makeEntry({ id: idCounter, status: 'published', visibility: 'internal' });
    mockPrisma._entries.set(entry.id, entry);
    idCounter++;

    const results = await knowledgeRepository.findForRetrieval({});

    expect(results.some(r => r.id === entry.id)).toBe(false);
  });

  it('8b. confidential visibility NOT returned by findForRetrieval()', async () => {
    const entry = makeEntry({ id: idCounter, status: 'published', visibility: 'confidential' });
    mockPrisma._entries.set(entry.id, entry);
    idCounter++;

    const results = await knowledgeRepository.findForRetrieval({});

    expect(results.some(r => r.id === entry.id)).toBe(false);
  });

  it('8c. private visibility NOT returned by findForRetrieval()', async () => {
    const entry = makeEntry({ id: idCounter, status: 'published', visibility: 'private' });
    mockPrisma._entries.set(entry.id, entry);
    idCounter++;

    const results = await knowledgeRepository.findForRetrieval({});

    expect(results.some(r => r.id === entry.id)).toBe(false);
  });

  // ─── Test 9: publish archived → published ────────────────────────────────

  it('9. archived → publish restores published', async () => {
    const entry = await adminService.create({ title: 'Entry', content: 'Content' });
    await adminService.publish(entry.id);
    await adminService.archive(entry.id);

    const published = await adminService.publish(entry.id);

    expect(published.status).toBe('published');
  });

  it('9b. non-existent id → publish throws NotFoundException (404)', async () => {
    await expect(adminService.publish(9999)).rejects.toThrow(NotFoundException);
  });

  // ─── Test 10: list pagination and filter ─────────────────────────────────

  it('10. list returns paginated results with meta', async () => {
    // Create 3 entries
    await adminService.create({ title: 'A', content: 'Content A' });
    await adminService.create({ title: 'B', content: 'Content B' });
    await adminService.create({ title: 'C', content: 'Content C' });

    const result = await adminService.list({ page: 1, pageSize: 2 });

    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(3);
    expect(result.meta.page).toBe(1);
    expect(result.meta.pageSize).toBe(2);
  });

  it('10b. list with status filter returns only matching entries', async () => {
    const draftEntry = await adminService.create({ title: 'Draft', content: 'Content' });
    const publishedEntry = await adminService.create({ title: 'Published', content: 'Content' });
    await adminService.publish(publishedEntry.id);

    const result = await adminService.list({ status: 'published' });

    expect(result.data.every(e => e.status === 'published')).toBe(true);
    expect(result.data.some(e => e.id === draftEntry.id)).toBe(false);
    expect(result.data.some(e => e.id === publishedEntry.id)).toBe(true);
  });

  // ─── update non-existent → 404 ───────────────────────────────────────────

  it('update non-existent entry throws NotFoundException', async () => {
    await expect(adminService.update(9999, { title: 'X' })).rejects.toThrow(NotFoundException);
  });

  // ─── archive no-op ───────────────────────────────────────────────────────

  it('archive already-archived is no-op (returns current entry)', async () => {
    const entry = await adminService.create({ title: 'Entry', content: 'Content' });
    await adminService.publish(entry.id);
    await adminService.archive(entry.id);

    // Archive again — should be no-op
    const result = await adminService.archive(entry.id);

    expect(result.status).toBe('archived');
  });

  // ─── getOneWithVersions includes version list ─────────────────────────────

  it('getOneWithVersions returns entry with version history after update', async () => {
    const entry = await adminService.create({ title: 'Entry', content: 'v1' });
    await adminService.update(entry.id, { content: 'v2' });

    const detail = await adminService.getOneWithVersions(entry.id);

    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0].versionNumber).toBe(1);
  });

  // ─── Snapshot completeness ────────────────────────────────────────────

  it('version snapshot includes aliases, category, answerType, templateKey, faqQuestions, crossLanguageGroupKey', async () => {
    const entry = await adminService.create({
      title: 'Snap Test',
      content: 'Original content',
      aliases: ['alias1', 'alias2'],
      category: 'product-spec',
      answerType: 'template',
      templateKey: 'tmpl-001',
      faqQuestions: ['Question one?', 'Question two?'],
      crossLanguageGroupKey: 'clg-001',
    });

    await adminService.update(entry.id, { title: 'Updated Title' });

    const snap = mockPrisma._versions[mockPrisma._versions.length - 1];
    const parsed = JSON.parse(snap.contentSnapshot) as Record<string, unknown>;

    expect(parsed.title).toBe('Snap Test');
    expect(parsed.content).toBe('Original content');
    expect(parsed.aliases).toEqual(['alias1', 'alias2']);
    expect(parsed.category).toBe('product-spec');
    expect(parsed.answerType).toBe('template');
    expect(parsed.templateKey).toBe('tmpl-001');
    expect(parsed.faqQuestions).toEqual(['Question one?', 'Question two?']);
    expect(parsed.crossLanguageGroupKey).toBe('clg-001');
  });
});
