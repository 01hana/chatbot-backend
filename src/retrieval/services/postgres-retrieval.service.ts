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
 * returned (enforced at the SQL level).
 *
 * Both strategies search across `title`, `content`, and `tags`:
 *  - pg_trgm:  GREATEST(similarity(title)*1.1, similarity(content)) + tag bonus
 *  - ILIKE:    title match → 0.8 | content match → 0.5 | tags match → 0.4
 *
 * A lightweight `normalizeQuery()` step runs before all DB calls.
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
    const normalized = PostgresRetrievalService.normalizeQuery(query.query);
    if (!normalized) return [];

    const normalizedQuery: RetrievalQuery = { ...query, query: normalized };
    const limit = normalizedQuery.limit ?? DEFAULT_LIMIT;

    if (this.trgmEnabled) {
      return this.retrieveWithTrgm(normalizedQuery, limit);
    }
    return this.retrieveWithIlike(normalizedQuery, limit);
  }

  /**
   * Lightweight query normalizer applied before every DB call.
   *
   *  - Strips leading question-starter phrases (請問、想問…)
   *  - Converts full-width ASCII characters to half-width
   *  - Strips trailing punctuation (？！。…)
   *  - Collapses internal whitespace
   */
  static normalizeQuery(raw: string): string {
    if (!raw) return '';

    let q = raw.trim();

    // Full-width ASCII → half-width  (！→!, ？→?, ＡＢＣ→ABC, etc.)
    q = q.replace(/[\uff01-\uff5e]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );

    // Strip common Chinese question-starter phrases
    q = q.replace(/^(請問(?:一下)?|想問(?:一下)?|我想問|請幫我|幫我查|查一下|告訴我)[，,\s]*/u, '').trim();

    // Strip trailing sentence-enders / question marks
    q = q.replace(/[？?！!。.…,，]+$/u, '').trim();

    // Collapse whitespace
    q = q.replace(/\s+/g, ' ').trim();

    return q.length > 0 ? q : raw.trim();
  }

  // ─── pg_trgm strategy ────────────────────────────────────────────────────

  /**
   * Uses pg_trgm `similarity()` across both `title` and `content`.
   * Score = LEAST(1.0, GREATEST(similarity(title)*1.1, similarity(content)) + tag_bonus).
   * Title gets a 10 % boost because a title match is a strong signal.
   *
   * Optional `intentLabel` and `tags` filters are parameterized to prevent SQL injection.
   */
  private async retrieveWithTrgm(query: RetrievalQuery, limit: number): Promise<RetrievalResult[]> {
    try {
      // Build a parameter list; $1 = query string, $2 = limit, $3+ = optional filters
      const params: unknown[] = [query.query, limit];
      let paramIdx = 3;

      let intentClause = '';
      if (query.intentLabel) {
        intentClause = `AND ke."intentLabel" = $${paramIdx++}`;
        params.push(query.intentLabel);
      }

      let tagClause = '';
      if (query.tags && query.tags.length > 0) {
        tagClause = `AND ke.tags @> $${paramIdx++}::text[]`;
        params.push(query.tags);
      }

      type TrgmRow = KnowledgeEntry & { similarity: number };

      const rows = await this.prisma.$queryRawUnsafe<TrgmRow[]>(
        `
        SELECT ke.*,
          LEAST(1.0,
            GREATEST(similarity(ke.title, $1) * 1.1, similarity(ke.content, $1))
            + CASE
                WHEN array_to_string(ke.tags, ' ') ILIKE '%' || $1 || '%' THEN 0.05
                ELSE 0
              END
          ) AS similarity
        FROM knowledge_entries ke
        WHERE ke.status = 'approved'
          AND ke.visibility = 'public'
          AND ke."deletedAt" IS NULL
          AND GREATEST(similarity(ke.title, $1), similarity(ke.content, $1)) > 0.1
          ${intentClause}
          ${tagClause}
        ORDER BY similarity DESC
        LIMIT $2
        `,
        ...params,
      );

      return rows.map(row => ({
        entry: this.stripExtraColumns(row),
        score: Number(row.similarity),
      }));
    } catch (err) {
      this.logger.warn(
        `pg_trgm retrieval failed, falling back to ILIKE: ${(err as Error).message}`,
      );
      return this.retrieveWithIlike(query, limit);
    }
  }

  // ─── ILIKE strategy ───────────────────────────────────────────────────────

  /**
   * ILIKE substring matching across `title`, `content`, and `tags`.
   * Scores: title match → 0.8 | content match → 0.5 | tags-only match → 0.4.
   *
   * Implemented as a raw SQL query so we can search `tags` (a text[] column)
   * and assign per-field scores in a single pass.
   */
  private async retrieveWithIlike(
    query: RetrievalQuery,
    limit: number,
  ): Promise<RetrievalResult[]> {
    const params: unknown[] = [query.query, limit];
    let paramIdx = 3;

    let intentClause = '';
    if (query.intentLabel) {
      intentClause = `AND ke."intentLabel" = $${paramIdx++}`;
      params.push(query.intentLabel);
    }

    let tagClause = '';
    if (query.tags && query.tags.length > 0) {
      tagClause = `AND ke.tags @> $${paramIdx++}::text[]`;
      params.push(query.tags);
    }

    type IlikeRow = KnowledgeEntry & { score: number };

    const rows = await this.prisma.$queryRawUnsafe<IlikeRow[]>(
      `
      SELECT ke.*,
        CASE
          WHEN ke.title ILIKE '%' || $1 || '%' THEN 0.8
          WHEN ke.content ILIKE '%' || $1 || '%' THEN 0.5
          ELSE 0.4
        END AS score
      FROM knowledge_entries ke
      WHERE ke.status = 'approved'
        AND ke.visibility = 'public'
        AND ke."deletedAt" IS NULL
        AND (
          ke.title ILIKE '%' || $1 || '%'
          OR ke.content ILIKE '%' || $1 || '%'
          OR array_to_string(ke.tags, ' ') ILIKE '%' || $1 || '%'
        )
        ${intentClause}
        ${tagClause}
      ORDER BY score DESC, ke."updatedAt" DESC
      LIMIT $2
      `,
      ...params,
    );

    return rows.map(row => ({
      entry: this.stripExtraColumns(row),
      score: Number(row.score),
    }));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Strip extra columns (`similarity`, `score`) added by raw queries. */
  private stripExtraColumns(
    row: KnowledgeEntry & { similarity?: number; score?: number },
  ): KnowledgeEntry {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { similarity: _sim, score: _score, ...entry } = row;
    return entry as KnowledgeEntry;
  }
}
