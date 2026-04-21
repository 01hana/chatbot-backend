import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { IRetrievalService } from '../interfaces/retrieval-service.interface';
import { RetrievalQuery, RetrievalResult } from '../types/retrieval.types';
import { KnowledgeEntry } from '../../generated/prisma/client';
import { QueryNormalizer } from '../query-normalizer';
import { RETRIEVAL_SCORING } from '../constants/retrieval-scoring.constants';

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
 * Both strategies search across `title`, `aliases`, `content`, and `tags`.
 * Scoring priority (highest → lowest):
 *  - pg_trgm:  title*1.2 > content*1.0 + alias ILIKE bonus 0.10 + tag ILIKE bonus 0.05
 *  - ILIKE:    title 0.90 > aliases 0.85 > tags 0.70 > content 0.50
 *
 * A two-step normalisation pipeline runs before all DB calls:
 *  1. QueryNormalizer.normalize() — strips question-shell phrases (lang-aware)
 *  2. QueryNormalizer.extractTerms() — extracts key terms for app-layer reranking
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
    const normalized = QueryNormalizer.normalize(query.query, query.language);
    if (!normalized) return [];

    const normalizedQuery: RetrievalQuery = { ...query, query: normalized };
    const limit = normalizedQuery.limit ?? DEFAULT_LIMIT;
    const lang = normalizedQuery.language ?? 'zh-TW';

    const strategy = (q: RetrievalQuery, lim: number, filterLang: string | undefined) =>
      this.trgmEnabled
        ? this.retrieveWithTrgm(q, lim, filterLang)
        : this.retrieveWithIlike(q, lim, filterLang);

    // ── First pass: same-language priority ─────────────────────────────
    if (normalizedQuery.language) {
      const sameLanguageResults = await strategy(normalizedQuery, limit, normalizedQuery.language);
      if (sameLanguageResults.length > 0) {
        return this.rerankWithTerms(sameLanguageResults, normalized, lang);
      }
      // No same-language hits — log and fall through to cross-language
      this.logger.debug(
        `[lang-fallback] No "${normalizedQuery.language}" results for "${normalized}" — ` +
        `falling back to cross-language retrieval`,
      );
    }

    // ── Second pass: cross-language fallback (no language filter) ──────
    const crossResults = await strategy(normalizedQuery, limit, undefined);
    const flagged = crossResults.map(r => ({ ...r, isCrossLanguageFallback: true }));
    return this.rerankWithTerms(flagged, normalized, lang);
  }

  /**
   * Normalise a user query before every DB call.
   *
   * Delegates to {@link QueryNormalizer.normalize} with an optional language hint.
   * Kept as a static method for backward-compatibility with existing callers and tests.
   *
   * @param raw      Raw user input
   * @param language Optional language hint: 'zh-TW' | 'en'
   */
  static normalizeQuery(raw: string, language?: string): string {
    return QueryNormalizer.normalize(raw, language);
  }

  // ─── pg_trgm strategy ────────────────────────────────────────────────────

  /**
   * Uses pg_trgm `similarity()` across `title`, `aliases`, and `content`.
   *
   * Score formula:
   *   LEAST(1.0,
   *     GREATEST(similarity(title)*1.2, similarity(content))
   *     + alias ILIKE bonus  (0.10)
   *     + tag   ILIKE bonus  (0.05)
   *   )
   *
   * Title gets a 20 % boost; alias ILIKE hit adds 0.10 bonus on top of trgm score.
   * Entries whose trigram score is below 0.1 may still be returned if they have
   * an alias or tag ILIKE match.
   *
   * Optional `intentLabel`, `tags`, and `language` filters are parameterised
   * to prevent SQL injection.
   */
  private async retrieveWithTrgm(
    query: RetrievalQuery,
    limit: number,
    language: string | undefined,
  ): Promise<RetrievalResult[]> {
    try {
      // $1 = query string, $2 = limit, $3+ = optional filter values
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

      let langClause = '';
      if (language) {
        langClause = `AND ke.language = $${paramIdx++}`;
        params.push(language);
      }

      type TrgmRow = KnowledgeEntry & { similarity: number };

      const trgmSql = `
        SELECT ke.*,
          LEAST(1.0,
            GREATEST(similarity(ke.title, $1) * ${RETRIEVAL_SCORING.TRGM_TITLE_BOOST}, similarity(ke.content, $1))
            + CASE
                WHEN array_to_string(ke.aliases, ' ') ILIKE '%' || $1 || '%' THEN ${RETRIEVAL_SCORING.TRGM_ALIAS_BONUS}
                ELSE 0
              END
            + CASE
                WHEN array_to_string(ke.tags, ' ') ILIKE '%' || $1 || '%' THEN ${RETRIEVAL_SCORING.TRGM_TAG_BONUS}
                ELSE 0
              END
          ) AS similarity
        FROM knowledge_entries ke
        WHERE ke.status = 'approved'
          AND ke.visibility = 'public'
          AND ke."deletedAt" IS NULL
          AND (
            GREATEST(similarity(ke.title, $1), similarity(ke.content, $1)) > ${RETRIEVAL_SCORING.TRGM_MIN_THRESHOLD}
            OR array_to_string(ke.aliases, ' ') ILIKE '%' || $1 || '%'
            OR array_to_string(ke.tags,    ' ') ILIKE '%' || $1 || '%'
          )
          ${intentClause}
          ${tagClause}
          ${langClause}
        ORDER BY similarity DESC
        LIMIT $2
        `;

      const rows = await this.prisma.$queryRawUnsafe<TrgmRow[]>(trgmSql, ...params);

      return rows.map(row => ({
        entry: this.stripExtraColumns(row),
        score: Number(row.similarity),
      }));
    } catch (err) {
      this.logger.warn(
        `pg_trgm retrieval failed, falling back to ILIKE: ${(err as Error).message}`,
      );
      return this.retrieveWithIlike(query, limit, language);
    }
  }

  // ─── ILIKE strategy ───────────────────────────────────────────────────────

  /**
   * ILIKE substring matching across `title`, `aliases`, `tags`, and `content`.
   *
   * Scoring priority:
   *   title match   → 0.90  (strongest signal)
   *   aliases match → 0.85  (FAQ phrase matched a known variant)
   *   tags match    → 0.70  (keyword hit)
   *   content match → 0.50  (weaker, body text)
   *
   * Implemented as a raw SQL query so we can search `tags` and `aliases`
   * (text[] columns) and assign per-field scores in a single pass.
   */
  private async retrieveWithIlike(
    query: RetrievalQuery,
    limit: number,
    language: string | undefined,
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

    let langClause = '';
    if (language) {
      langClause = `AND ke.language = $${paramIdx++}`;
      params.push(language);
    }

    type IlikeRow = KnowledgeEntry & { score: number };

    const ilikeSql = `
      SELECT ke.*,
        CASE
          WHEN ke.title                             ILIKE '%' || $1 || '%' THEN ${RETRIEVAL_SCORING.ILIKE_TITLE_SCORE}
          WHEN array_to_string(ke.aliases, ' ')     ILIKE '%' || $1 || '%' THEN ${RETRIEVAL_SCORING.ILIKE_ALIAS_SCORE}
          WHEN array_to_string(ke.tags,    ' ')     ILIKE '%' || $1 || '%' THEN ${RETRIEVAL_SCORING.ILIKE_TAG_SCORE}
          WHEN ke.content                           ILIKE '%' || $1 || '%' THEN ${RETRIEVAL_SCORING.ILIKE_CONTENT_SCORE}
          ELSE 0.0
        END AS score
      FROM knowledge_entries ke
      WHERE ke.status = 'approved'
        AND ke.visibility = 'public'
        AND ke."deletedAt" IS NULL
        AND (
          ke.title                             ILIKE '%' || $1 || '%'
          OR array_to_string(ke.aliases, ' ') ILIKE '%' || $1 || '%'
          OR ke.content                        ILIKE '%' || $1 || '%'
          OR array_to_string(ke.tags,    ' ') ILIKE '%' || $1 || '%'
        )
        ${intentClause}
        ${tagClause}
        ${langClause}
      ORDER BY score DESC, ke."updatedAt" DESC
      LIMIT $2
      `;

    const rows = await this.prisma.$queryRawUnsafe<IlikeRow[]>(ilikeSql, ...params);

    return rows.map(row => ({
      entry: this.stripExtraColumns(row),
      score: Number(row.score),
    }));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Application-layer reranking using extracted search terms.
   *
   * After SQL retrieval, boost entries whose title or aliases contain
   * multiple terms from the normalised query. This improves recall for
   * multi-word queries where no single column matches the full string.
   *
   * Score bonus per matching term:
   *   +0.05 if term appears in title
   *   +0.04 if term appears in aliases
   *
   * Results are re-sorted by boosted score (descending). Total score is
   * capped at 1.0.
   */
  private rerankWithTerms(
    results: RetrievalResult[],
    normalizedQuery: string,
    language: string,
  ): RetrievalResult[] {
    const terms = QueryNormalizer.extractTerms(normalizedQuery, language);
    // Reranking only adds value when there are 2+ extracted terms to compare
    if (terms.length < RETRIEVAL_SCORING.RERANK_MIN_TERMS) return results;

    const reranked = results.map(r => {
      const titleLower = r.entry.title.toLowerCase();
      const aliasesText = (r.entry.aliases ?? []).join(' ').toLowerCase();

      let bonus = 0;
      for (const term of terms) {
        const t = term.toLowerCase();
        if (titleLower.includes(t)) bonus += RETRIEVAL_SCORING.RERANK_TITLE_TERM_BONUS;
        else if (aliasesText.includes(t)) bonus += RETRIEVAL_SCORING.RERANK_ALIAS_TERM_BONUS;
      }

      return bonus > 0 ? { ...r, score: Math.min(1.0, r.score + bonus) } : r;
    });

    return reranked.sort((a, b) => b.score - a.score);
  }

  /** Strip extra computed columns (`similarity`, `score`) added by raw queries. */
  private stripExtraColumns(
    row: KnowledgeEntry & { similarity?: number; score?: number },
  ): KnowledgeEntry {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { similarity: _sim, score: _score, ...entry } = row;
    return entry as KnowledgeEntry;
  }
}
