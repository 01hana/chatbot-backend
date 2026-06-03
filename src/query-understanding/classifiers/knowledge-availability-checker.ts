import { Injectable } from '@nestjs/common';
import { KnowledgeDocType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QueryType } from '../types/query-type.enum.js';

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: boolean;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds

// ── Content hint types ────────────────────────────────────────────────────────

/**
 * ContentHint — queryType-specific signals used to restrict availability checks
 * to KB content meaningful for each intent.
 *
 * All non-empty arrays generate additive OR conditions — a single signal match
 * in any field is sufficient to count the entry as relevant.
 *
 * Empty arrays for a given field are skipped (no condition generated).
 */
interface ContentHint {
  /** Exact values for KnowledgeEntry.category */
  entryCategories: string[];
  /** Exact values for KnowledgeEntry.intentLabel */
  entryIntentLabels: string[];
  /** hasSome values for KnowledgeEntry.tags (PostgreSQL array) */
  entryTags: string[];
  /** hasSome values for KnowledgeEntry.aliases (PostgreSQL array) */
  entryAliases: string[];
  /** Exact values for KnowledgeEntry.sourceKey */
  entrySourceKeys: string[];
  /** Keywords for case-insensitive contains on KnowledgeEntry.title / .content */
  entryKeywords: string[];
  /** KnowledgeDocument.docType enum values */
  docTypes: KnowledgeDocType[];
  /** Exact values for KnowledgeDocument.sourceKey */
  docSourceKeys: string[];
  /** Keywords for case-insensitive contains on KnowledgeDocument.title */
  docKeywords: string[];
}

// Structural subset of KnowledgeEntryWhereInput for OR clauses
interface EntryOrClause {
  category?: { in: string[] };
  intentLabel?: { in: string[] };
  tags?: { hasSome: string[] };
  aliases?: { hasSome: string[] };
  sourceKey?: { in: string[] };
  title?: { contains: string; mode: 'insensitive' };
  content?: { contains: string; mode: 'insensitive' };
}

// Structural subset of KnowledgeDocumentWhereInput (used inside chunk OR clauses)
interface DocOrClause {
  docType?: { in: KnowledgeDocType[] };
  sourceKey?: { in: string[] };
  title?: { contains: string; mode: 'insensitive' };
}

/**
 * ChunkOrClause — OR conditions applied at the chunk level.
 *
 * Each clause can match either directly on `chunk.content` or via a nested
 * `document` sub-filter (e.g. docType, sourceKey, document title).
 * The security invariants on the parent document (status/visibility/deletedAt)
 * are enforced as top-level AND conditions and are not overridable here.
 */
interface ChunkOrClause {
  content?: { contains: string; mode: 'insensitive' };
  document?: DocOrClause;
}

// ── QueryType → content hint mapping ─────────────────────────────────────────

/**
 * Maps each QueryType to the KB content signals that indicate relevant content
 * exists.  QueryType.Unknown and QueryType.Unsupported are intentionally absent:
 *   - Unknown     → `hasContentFor()` returns `false` immediately; no DB query.
 *   - Unsupported → SupportabilityClassifier short-circuits before calling
 *                   `hasContentFor()`; `hasContentFor()` also returns `false`
 *                   as a defensive guard.
 */
const CONTENT_HINTS: Partial<Record<QueryType, ContentHint>> = {
  [QueryType.BusinessHours]: {
    entryCategories: ['business_hours', 'company_info'],
    entryIntentLabels: ['business_hours', 'company_info'],
    entryTags: ['business_hours', 'company_info', 'hours', '營業時間', '上班時間', '公司地址'],
    entryAliases: ['上班時間', '營業時間', '公司地址', '辦公地址'],
    entrySourceKeys: ['business-hours', 'company-info', 'office-hours'],
    entryKeywords: ['上班', '營業', '地址', 'hours', 'address'],
    docTypes: [KnowledgeDocType.company_info],
    docSourceKeys: ['company-info', 'business-hours'],
    docKeywords: ['上班', '營業', '地址'],
  },

  [QueryType.Contact]: {
    entryCategories: ['contact', 'company_info'],
    entryIntentLabels: ['contact', 'company_info'],
    entryTags: ['contact', 'company_info', '聯絡', '電話', 'email'],
    entryAliases: ['聯絡方式', '電話', '信箱', 'email'],
    entrySourceKeys: ['contact', 'contact-us'],
    entryKeywords: ['聯絡', '電話', 'email', 'contact'],
    docTypes: [KnowledgeDocType.company_info],
    docSourceKeys: ['contact', 'contact-us'],
    docKeywords: ['聯絡', '電話', 'contact'],
  },

  [QueryType.CatalogDownload]: {
    entryCategories: ['catalog', 'faq-general'],
    entryIntentLabels: ['catalog', 'catalog_download'],
    entryTags: ['catalog', '型錄', '目錄', 'download'],
    entryAliases: ['型錄', '目錄', 'catalog'],
    entrySourceKeys: ['catalog', 'product-catalog'],
    entryKeywords: ['型錄', '目錄', 'catalog'],
    docTypes: [KnowledgeDocType.catalog],
    docSourceKeys: ['catalog', 'product-catalog'],
    docKeywords: ['型錄', '目錄', 'catalog'],
  },

  [QueryType.QuoteRequest]: {
    entryCategories: ['pricing', 'sales', 'contact'],
    entryIntentLabels: ['quote_request', 'pricing', 'sales'],
    entryTags: ['quote', 'pricing', 'sales', '報價', '詢價', '聯絡業務'],
    entryAliases: ['報價', '詢價', '業務'],
    entrySourceKeys: ['quote', 'pricing', 'sales'],
    entryKeywords: ['報價', '詢價', '業務', 'quote', 'price'],
    docTypes: [KnowledgeDocType.company_info, KnowledgeDocType.general],
    docSourceKeys: ['quote', 'pricing'],
    docKeywords: ['報價', '詢價', 'quote'],
  },

  [QueryType.ProductLookup]: {
    entryCategories: ['product-spec', 'faq-general', 'product', 'faq'],
    entryIntentLabels: ['product_lookup', 'product_spec', 'product'],
    entryTags: ['product', 'product-spec', 'faq', '產品', '螺絲'],
    entryAliases: ['產品', '螺絲'],
    entrySourceKeys: [],
    entryKeywords: ['產品', '規格', 'product'],
    docTypes: [
      KnowledgeDocType.product_spec,
      KnowledgeDocType.faq,
      KnowledgeDocType.catalog,
      KnowledgeDocType.general,
    ],
    docSourceKeys: [],
    docKeywords: ['產品', 'product'],
  },

  [QueryType.ProductComparison]: {
    entryCategories: ['product-spec', 'material', 'spec'],
    entryIntentLabels: ['product_comparison', 'product_spec'],
    entryTags: ['product-spec', 'spec', 'material', '304', '316', '比較'],
    entryAliases: ['規格', '比較'],
    entrySourceKeys: [],
    entryKeywords: ['規格', '材質', 'spec', 'material'],
    docTypes: [KnowledgeDocType.product_spec],
    docSourceKeys: [],
    docKeywords: ['規格', '材質', 'spec'],
  },

  [QueryType.GeneralFaq]: {
    entryCategories: ['faq-general', 'general', 'faq'],
    entryIntentLabels: ['general_faq', 'faq'],
    entryTags: ['faq', 'general', '常見問題'],
    entryAliases: [],
    entrySourceKeys: [],
    entryKeywords: ['常見', 'faq'],
    docTypes: [KnowledgeDocType.faq, KnowledgeDocType.general],
    docSourceKeys: [],
    docKeywords: ['常見', 'faq'],
  },
};

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * KnowledgeAvailabilityChecker — checks whether the knowledge base contains
 * content relevant to a given (queryType, language) pair.
 *
 * Dual-source strategy:
 *   ① `KnowledgeEntry` (legacy table): `status='published'`, `visibility='public'`,
 *      `deletedAt IS NULL`, plus queryType-specific OR conditions on category /
 *      intentLabel / tags / aliases / sourceKey / title / content.
 *   ② `KnowledgeDocument` + `KnowledgeChunk` (V2 tables): `status='published'`,
 *      `visibility='public'`, `deletedAt IS NULL`, plus queryType-specific OR
 *      conditions on docType / sourceKey / title.
 *
 * Language matching: exact match first; language-agnostic fallback when neither
 * source returns a result for the given language.
 *
 * Results are cached per `queryType:language` key for 60 s.
 */
@Injectable()
export class KnowledgeAvailabilityChecker {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns `true` if the KB contains published, public content relevant to the
   * given (queryType, language) pair.
   *
   * Defensive early-returns (no DB query):
   *   - `QueryType.Unknown`     — unclassified intent; no meaningful KB mapping.
   *   - `QueryType.Unsupported` — SupportabilityClassifier short-circuits first,
   *                               but this guard prevents accidental direct calls.
   *
   * @param queryType  The classified query intent.
   * @param language   ISO language tag, e.g. 'zh-TW' | 'en'.
   */
  async hasContentFor(queryType: QueryType, language: string): Promise<boolean> {
    if (
      queryType === QueryType.Unknown ||
      queryType === QueryType.Unsupported
    ) {
      return false;
    }

    const cacheKey = `${queryType}:${language}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined && Date.now() < cached.expiresAt) {
      return cached.result;
    }

    const hint = CONTENT_HINTS[queryType] ?? null;
    const result = await this.checkBothSources(hint, language);
    this.cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  /** Invalidate all cached entries (useful in tests or after bulk data changes). */
  clearCache(): void {
    this.cache.clear();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async checkBothSources(
    hint: ContentHint | null,
    language: string,
  ): Promise<boolean> {
    // ── Exact language match ─────────────────────────────────────────────
    const [entryCount, chunkCount] = await Promise.all([
      this.countKnowledgeEntries(hint, language),
      this.countKnowledgeChunks(hint, language),
    ]);
    if (entryCount > 0 || chunkCount > 0) return true;

    // ── Language-agnostic fallback ───────────────────────────────────────
    const [fallbackEntry, fallbackChunk] = await Promise.all([
      this.countKnowledgeEntries(hint, undefined),
      this.countKnowledgeChunks(hint, undefined),
    ]);
    return fallbackEntry > 0 || fallbackChunk > 0;
  }

  /**
   * Count published, public, non-deleted KnowledgeEntry rows that satisfy the
   * queryType content hint OR conditions.
   * When hint is null (Unknown queryType), any published/public row qualifies.
   */
  private async countKnowledgeEntries(
    hint: ContentHint | null,
    language?: string,
  ): Promise<number> {
    const orClauses = hint ? this.buildEntryOrClauses(hint) : [];
    return this.prisma.knowledgeEntry.count({
      where: {
        // SECURITY INVARIANT: always enforce published + public + not deleted
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        ...(language !== undefined ? { language } : {}),
        ...(orClauses.length > 0 ? { OR: orClauses } : {}),
      },
    });
  }

  /**
   * Count KnowledgeChunk rows whose parent KnowledgeDocument is published,
   * public, and non-deleted, and that satisfy queryType-specific OR conditions
   * on either chunk.content (text keywords) or the parent document metadata
   * (docType, sourceKey, title).
   *
   * Security invariants (status/visibility/deletedAt) on the parent document
   * are always AND-enforced at the top level and cannot be bypassed by hint
   * conditions.
   *
   * When hint is null (QueryType.Unsupported / fallback), any chunk under an
   * published/public document qualifies — but callers should normally short-
   * circuit before reaching this path for null hints.
   */
  private async countKnowledgeChunks(
    hint: ContentHint | null,
    language?: string,
  ): Promise<number> {
    const chunkOrClauses = hint ? this.buildChunkOrClauses(hint) : [];
    return this.prisma.knowledgeChunk.count({
      where: {
        ...(language !== undefined ? { language } : {}),
        // Security invariants — always AND, never overridable
        document: {
          status: 'published',
          visibility: 'public',
          deletedAt: null,
        },
        ...(chunkOrClauses.length > 0 ? { OR: chunkOrClauses } : {}),
      },
    });
  }

  /**
   * Build OR conditions for KnowledgeEntry from the content hint.
   * Conditions are additive — any single signal match is sufficient.
   * Fields with empty arrays are skipped.
   */
  private buildEntryOrClauses(hint: ContentHint): EntryOrClause[] {
    const clauses: EntryOrClause[] = [];

    if (hint.entryCategories.length > 0) {
      clauses.push({ category: { in: hint.entryCategories } });
    }
    if (hint.entryIntentLabels.length > 0) {
      clauses.push({ intentLabel: { in: hint.entryIntentLabels } });
    }
    if (hint.entryTags.length > 0) {
      clauses.push({ tags: { hasSome: hint.entryTags } });
    }
    if (hint.entryAliases.length > 0) {
      clauses.push({ aliases: { hasSome: hint.entryAliases } });
    }
    if (hint.entrySourceKeys.length > 0) {
      clauses.push({ sourceKey: { in: hint.entrySourceKeys } });
    }
    for (const keyword of hint.entryKeywords) {
      clauses.push({ title: { contains: keyword, mode: 'insensitive' } });
      clauses.push({ content: { contains: keyword, mode: 'insensitive' } });
    }

    return clauses;
  }

  /**
   * Build chunk-level OR conditions from the content hint.
   *
   * Each clause matches either:
   *   - Directly on `chunk.content` (text keyword from entryKeywords or docKeywords)
   *   - Via nested `document` sub-filter (docType, sourceKey, document title)
   *
   * The parent document's security invariants (status/visibility/deletedAt) are
   * enforced separately as top-level AND conditions in `countKnowledgeChunks`.
   */
  private buildChunkOrClauses(hint: ContentHint): ChunkOrClause[] {
    const clauses: ChunkOrClause[] = [];

    // Document-metadata signals (docType, sourceKey, title)
    if (hint.docTypes.length > 0) {
      clauses.push({ document: { docType: { in: hint.docTypes } } });
    }
    if (hint.docSourceKeys.length > 0) {
      clauses.push({ document: { sourceKey: { in: hint.docSourceKeys } } });
    }
    for (const keyword of hint.docKeywords) {
      clauses.push({ document: { title: { contains: keyword, mode: 'insensitive' } } });
    }

    // Chunk-content signals: use entryKeywords as content-level signals
    // (same vocabulary that applies to KnowledgeEntry.content applies to chunk text)
    for (const keyword of hint.entryKeywords) {
      clauses.push({ content: { contains: keyword, mode: 'insensitive' } });
    }

    return clauses;
  }
}
