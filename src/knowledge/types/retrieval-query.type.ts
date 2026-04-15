/**
 * Query parameters for KnowledgeRepository.findForRetrieval().
 *
 * Note: `status` and `visibility` are intentionally excluded — they are always
 * forced to `approved` and `public` respectively by the repository and cannot
 * be overridden by callers.
 */
export interface RetrievalQuery {
  /**
   * Free-text search string (used for ILIKE / pg_trgm similarity matching).
   * Optional — when absent the repository returns all eligible entries.
   */
  query?: string;

  /**
   * Optional intent label filter (e.g. "product-inquiry").
   * When provided, only entries whose `intentLabel` matches are returned.
   */
  intentLabel?: string;

  /**
   * Optional tag filter.
   * When provided, only entries whose `tags` array contains ALL of the
   * specified tags are returned.
   */
  tags?: string[];

  /**
   * Maximum number of rows to return.
   * Defaults to 20 when not specified.
   */
  limit?: number;
}

/**
 * Data-transfer shape for knowledge entries returned from the repository.
 * Mirrors the Prisma `KnowledgeEntry` model without the relation field.
 */
export interface KnowledgeEntryDto {
  id: number;
  title: string;
  content: string;
  intentLabel: string | null;
  tags: string[];
  status: string;
  visibility: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
