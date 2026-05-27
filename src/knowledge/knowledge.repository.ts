import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeEntry, KnowledgeVersion } from '../generated/prisma/client';
import { RetrievalQuery } from './types/retrieval-query.type';

const DEFAULT_RETRIEVAL_LIMIT = 20;

const ALLOWED_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'title', 'version', 'status']);

/** Parameters for the admin paginated list endpoint. */
export interface KnowledgeListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  visibility?: string;
  language?: string;
  intentLabel?: string;
  sourceKey?: string;
  sortBy?: string;
  sortOrder?: string;
}

/**
 * KnowledgeRepository — data-access layer for knowledge_entries and
 * knowledge_versions tables.
 *
 * Security contract:
 *  `findForRetrieval()` ALWAYS enforces `status = 'approved'` AND
 *  `visibility = 'public'`. These filters are part of the method signature
 *  and cannot be removed or bypassed by callers. Any relaxation requires a
 *  deliberate change to this method (protected by code review).
 */
@Injectable()
export class KnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Retrieval (RAG path) ─────────────────────────────────────────────────

  /**
   * Find knowledge entries eligible for RAG retrieval.
   *
   * Enforced invariants (never overridable by callers):
   *  - `status  = 'approved'`
   *  - `visibility = 'public'`
   *  - `deletedAt IS NULL` (soft-delete excluded)
   *
   * Additional caller-supplied filters (`intentLabel`, `tags`) narrow the
   * result set further but cannot relax the above invariants.
   *
   * @param query - Optional caller filters (query string, intentLabel, tags, limit).
   * @returns Array of KnowledgeEntry rows matching all criteria.
   */
  async findForRetrieval(query: RetrievalQuery = {}): Promise<KnowledgeEntry[]> {
    const { intentLabel, tags, limit = DEFAULT_RETRIEVAL_LIMIT } = query;

    return this.prisma.knowledgeEntry.findMany({
      where: {
        // ─ SECURITY INVARIANT — DO NOT REMOVE ─────────────────────────────
        status: 'approved',
        visibility: 'public',
        // ──────────────────────────────────────────────────────────────────
        deletedAt: null,
        ...(intentLabel ? { intentLabel } : {}),
        ...(tags && tags.length > 0 ? { tags: { hasEvery: tags } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  /**
   * Find a single knowledge entry by primary key.
   * Returns null when not found.
   */
  async findById(id: number): Promise<KnowledgeEntry | null> {
    return this.prisma.knowledgeEntry.findUnique({ where: { id } });
  }

  /**
   * Find all non-deleted knowledge entries (admin use only).
   * Unlike `findForRetrieval`, this does NOT filter by status or visibility —
   * it is intended for the admin panel where all entries must be visible.
   */
  async findAll(): Promise<KnowledgeEntry[]> {
    return this.prisma.knowledgeEntry.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Create a new knowledge entry with default status = 'draft'.
   */
  async create(
    data: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'versions' | 'structuredAttributes'>,
  ): Promise<KnowledgeEntry> {
    return this.prisma.knowledgeEntry.create({
      data: {
        title: data.title,
        content: data.content,
        intentLabel: data.intentLabel,
        tags: data.tags,
        aliases: data.aliases ?? [],
        language: data.language ?? 'zh-TW',
        status: data.status ?? 'draft',
        visibility: data.visibility ?? 'private',
        version: data.version ?? 1,
        sourceKey: data.sourceKey ?? null,
        category: data.category ?? null,
        answerType: data.answerType ?? 'rag',
        templateKey: data.templateKey ?? null,
        faqQuestions: data.faqQuestions ?? [],
        crossLanguageGroupKey: data.crossLanguageGroupKey ?? null,
      },
    });
  }

  /**
   * Update mutable fields of an existing knowledge entry.
   * Returns the updated row or null when not found.
   */
  async update(
    id: number,
    data: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'intentLabel' | 'tags' | 'aliases' | 'language' | 'status' | 'visibility' | 'sourceKey' | 'category' | 'answerType' | 'templateKey' | 'faqQuestions' | 'crossLanguageGroupKey'>>,
  ): Promise<KnowledgeEntry | null> {
    try {
      return await this.prisma.knowledgeEntry.update({
        where: { id },
        data,
      });
    } catch {
      return null;
    }
  }

  /**
   * Soft-delete a knowledge entry by setting `deletedAt`.
   * Returns true when the entry was found and marked deleted; false otherwise.
   */
  async softDelete(id: number): Promise<boolean> {
    try {
      await this.prisma.knowledgeEntry.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find all non-deleted knowledge entries belonging to a given category.
   */
  async findByCategory(category: string): Promise<KnowledgeEntry[]> {
    return this.prisma.knowledgeEntry.findMany({
      where: { category, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // ─── Admin list (paginated + filtered) ────────────────────────────────────

  /**
   * Paginated, filtered list of non-deleted entries for the admin panel.
   * Supports keyword search across title and content (case-insensitive).
   * The sortBy field is restricted to a safe allowlist to prevent injection.
   */
  async findFiltered(
    params: KnowledgeListParams,
  ): Promise<{ items: KnowledgeEntry[]; total: number }> {
    const {
      page = 1,
      pageSize = 20,
      keyword,
      status,
      visibility,
      language,
      intentLabel,
      sourceKey,
      sortOrder = 'desc',
    } = params;

    const safeSortBy = params.sortBy && ALLOWED_SORT_FIELDS.has(params.sortBy) ? params.sortBy : 'updatedAt';

    const where = {
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(visibility ? { visibility } : {}),
      ...(language ? { language } : {}),
      ...(intentLabel ? { intentLabel } : {}),
      ...(sourceKey ? { sourceKey } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword, mode: 'insensitive' as const } },
              { content: { contains: keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.knowledgeEntry.findMany({
        where,
        orderBy: { [safeSortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.knowledgeEntry.count({ where }),
    ]);

    return { items, total };
  }

  // ─── Detail with versions ─────────────────────────────────────────────────

  /**
   * Find a single entry by ID including its version history.
   * Returns null when not found.
   */
  async findByIdWithVersions(
    id: number,
  ): Promise<(KnowledgeEntry & { versions: KnowledgeVersion[] }) | null> {
    return this.prisma.knowledgeEntry.findUnique({
      where: { id },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    }) as Promise<(KnowledgeEntry & { versions: KnowledgeVersion[] }) | null>;
  }

  // ─── Version snapshots ────────────────────────────────────────────────────

  /**
   * Create an immutable version snapshot for a knowledge entry.
   */
  async createVersion(data: {
    knowledgeEntryId: number;
    versionNumber: number;
    contentSnapshot: string;
  }): Promise<KnowledgeVersion> {
    return this.prisma.knowledgeVersion.create({ data }) as Promise<KnowledgeVersion>;
  }

  /**
   * Update a knowledge entry and snapshot the current content as a new version.
   * Performed atomically in a transaction:
   *   1. Snapshot current entry content → KnowledgeVersion
   *   2. Apply new data, increment version, reset status to 'draft'
   *
   * Returns the updated entry, or null when the entry does not exist.
   */
  async updateWithVersionSnapshot(
    id: number,
    data: Partial<
      Pick<
        KnowledgeEntry,
        | 'title'
        | 'content'
        | 'intentLabel'
        | 'tags'
        | 'aliases'
        | 'language'
        | 'visibility'
        | 'sourceKey'
        | 'category'
        | 'answerType'
        | 'templateKey'
        | 'faqQuestions'
        | 'crossLanguageGroupKey'
      >
    >,
  ): Promise<KnowledgeEntry | null> {
    const current = await this.prisma.knowledgeEntry.findUnique({ where: { id } });
    if (!current) return null;

    const contentSnapshot = JSON.stringify({
      title: current.title,
      content: current.content,
      intentLabel: current.intentLabel,
      tags: current.tags,
      aliases: current.aliases,
      language: current.language,
      sourceKey: current.sourceKey,
      visibility: current.visibility,
      status: current.status,
      category: current.category,
      answerType: current.answerType,
      templateKey: current.templateKey,
      faqQuestions: current.faqQuestions,
      crossLanguageGroupKey: current.crossLanguageGroupKey,
      structuredAttributes: current.structuredAttributes,
    });

    const [, updated] = await this.prisma.$transaction([
      this.prisma.knowledgeVersion.create({
        data: {
          knowledgeEntryId: id,
          versionNumber: current.version,
          contentSnapshot,
        },
      }),
      this.prisma.knowledgeEntry.update({
        where: { id },
        data: {
          ...data,
          version: current.version + 1,
          status: 'draft',
        },
      }),
    ]);

    return updated as KnowledgeEntry;
  }
}
