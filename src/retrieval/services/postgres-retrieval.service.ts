import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { IRetrievalService } from '../interfaces/retrieval-service.interface';
import { RetrievalQuery, RetrievalResult } from '../types/retrieval.types';
import { KnowledgeEntry } from '../../generated/prisma/client';

const DEFAULT_LIMIT = 5;

/**
 * PostgresRetrievalService — production retrieval implementation backed by
 * PostgreSQL.
 *
 * Strategy selection (env-driven):
 *  - `PG_TRGM_ENABLED=true`  → uses `pg_trgm` similarity query (preferred)
 *  - `PG_TRGM_ENABLED=false` → falls back to `ILIKE` substring matching
 *
 * In both cases only `status='approved' AND visibility='public'` entries are
 * returned (enforced at the SQL level via raw query / where clause).
 *
 * Similarity scores:
 *  - pg_trgm:  the trigram similarity value returned by Postgres (0–1)
 *  - ILIKE:    a fixed score of 0.5 for any matching row (no ranking)
 */
@Injectable()
export class PostgresRetrievalService implements IRetrievalService {
  private readonly logger = new Logger(PostgresRetrievalService.name);
  private readonly trgmEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.trgmEnabled = this.configService.get<string>('PG_TRGM_ENABLED') === 'true';
    this.logger.log(`Retrieval strategy: ${this.trgmEnabled ? 'pg_trgm' : 'ILIKE'}`);
  }

  async retrieve(query: RetrievalQuery): Promise<RetrievalResult[]> {
    const limit = query.limit ?? DEFAULT_LIMIT;

    if (this.trgmEnabled) {
      return this.retrieveWithTrgm(query, limit);
    }
    return this.retrieveWithIlike(query, limit);
  }

  // ─── pg_trgm strategy ────────────────────────────────────────────────────

  /**
   * Uses `similarity(content, $query)` from pg_trgm to rank entries.
   * Additional filters (`intentLabel`, `tags`) are applied as WHERE clauses.
   */
  private async retrieveWithTrgm(query: RetrievalQuery, limit: number): Promise<RetrievalResult[]> {
    try {
      // Build dynamic filter fragments
      const intentClause = query.intentLabel
        ? `AND ke."intentLabel" = '${query.intentLabel.replace(/'/g, "''")}'`
        : '';

      const tagClause =
        query.tags && query.tags.length > 0
          ? `AND ke.tags @> ARRAY[${query.tags.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ')}]::text[]`
          : '';

      type TrgmRow = KnowledgeEntry & { similarity: number };

      const rows = await this.prisma.$queryRawUnsafe<TrgmRow[]>(
        `
        SELECT ke.*, similarity(ke.content, $1) AS similarity
        FROM knowledge_entries ke
        WHERE ke.status = 'approved'
          AND ke.visibility = 'public'
          AND ke."deletedAt" IS NULL
          AND similarity(ke.content, $1) > 0.1
          ${intentClause}
          ${tagClause}
        ORDER BY similarity DESC
        LIMIT $2
        `,
        query.query,
        limit,
      );

      return rows.map((row) => ({
        entry: this.stripSimilarity(row),
        score: Number(row.similarity),
      }));
    } catch (err) {
      this.logger.warn(`pg_trgm retrieval failed, falling back to ILIKE: ${(err as Error).message}`);
      return this.retrieveWithIlike(query, limit);
    }
  }

  // ─── ILIKE fallback strategy ──────────────────────────────────────────────

  /**
   * Falls back to ILIKE substring matching when pg_trgm is unavailable.
   * All matching rows get a fixed score of 0.5.
   */
  private async retrieveWithIlike(query: RetrievalQuery, limit: number): Promise<RetrievalResult[]> {
    const likePattern = `%${query.query}%`;

    const entries = await this.prisma.knowledgeEntry.findMany({
      where: {
        status: 'approved',
        visibility: 'public',
        deletedAt: null,
        content: { contains: query.query, mode: 'insensitive' },
        ...(query.intentLabel ? { intentLabel: query.intentLabel } : {}),
        ...(query.tags && query.tags.length > 0 ? { tags: { hasEvery: query.tags } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    void likePattern; // suppress unused-variable warning
    return entries.map((entry) => ({ entry, score: 0.5 }));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Strip the extra `similarity` column added by the raw query. */
  private stripSimilarity(row: KnowledgeEntry & { similarity?: number }): KnowledgeEntry {
    const { similarity: _s, ...entry } = row as KnowledgeEntry & { similarity?: number };
    void _s;
    return entry as KnowledgeEntry;
  }
}
