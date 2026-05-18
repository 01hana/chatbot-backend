/**
 * SourceReference — identifies a knowledge source referenced in a generated answer.
 *
 * At least one of `knowledgeEntryId` or `chunkId` must be present.
 * The `sourceKey` field is always required and acts as a human-readable identifier.
 */
export type SourceReference = (
  | { knowledgeEntryId: number; chunkId?: string }
  | { knowledgeEntryId?: number; chunkId: string }
) & {
  /** Stable string key for the knowledge source (e.g. "entry:42" or a slug). */
  sourceKey: string;
  /** Display title of the knowledge document or entry, if available. */
  title?: string;
  /** BCP-47 language tag of the source content (e.g. "zh-TW", "en"). */
  language?: string;
  /** Category tag of the knowledge entry (e.g. "product", "faq"). */
  category?: string;
  /** Retrieval score for this source in the current turn (0–1). */
  score?: number;
  /** Zero-based index of this chunk in the ordered result set. */
  chunkIndex: number;
};
