import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeEntry } from '../generated/prisma/client';
import { RetrievalQuery } from './types/retrieval-query.type';

const DEFAULT_RETRIEVAL_LIMIT = 20;

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
   * Create a new knowledge entry with default status = 'draft'.
   */
  async create(
    data: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'versions'>,
  ): Promise<KnowledgeEntry> {
    return this.prisma.knowledgeEntry.create({
      data: {
        title: data.title,
        content: data.content,
        intentLabel: data.intentLabel,
        tags: data.tags,
        status: data.status ?? 'draft',
        visibility: data.visibility ?? 'private',
        version: data.version ?? 1,
      },
    });
  }

  /**
   * Update mutable fields of an existing knowledge entry.
   * Returns the updated row or null when not found.
   */
  async update(
    id: number,
    data: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'intentLabel' | 'tags' | 'status' | 'visibility'>>,
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
}
