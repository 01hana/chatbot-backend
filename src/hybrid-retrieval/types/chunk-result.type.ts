/**
 * ChunkResult — a single retrieval hit returned by any retriever
 * (KeywordRetriever, VectorRetrieverStub, GraphRetrieverStub).
 *
 * At least one of `chunkId` or `knowledgeEntryId` MUST be present.
 * The union type enforces this constraint at the TypeScript level.
 */

/** Hit originates from a KnowledgeChunk row (Phase 3+ graph/vector). */
interface ChunkResultWithChunkId {
  /** PK of the KnowledgeChunk that was matched. */
  chunkId: string;
  /** PK of the parent KnowledgeEntry (optional when chunk is known). */
  knowledgeEntryId?: number;
  /** Human-readable source key (e.g. knowledge entry sourceKey or chunk ref). */
  sourceKey: string;
  /** Text content of the matched chunk / entry. */
  content: string;
  /** Relevance score in [0, 1]. Higher is more relevant. */
  score: number;
  /** ISO language tag of the content (e.g. 'zh-TW', 'en'). */
  language: string;
  /** True when the result was returned via cross-language fallback. */
  isCrossLanguageFallback?: boolean;
}

/** Hit originates from a KnowledgeEntry row (Phase 3 V1 keyword path). */
interface ChunkResultWithEntryId {
  /** PK of the matched KnowledgeEntry. */
  knowledgeEntryId: number;
  /** chunkId is absent for KnowledgeEntry-based hits. */
  chunkId?: never;
  /** Human-readable source key (e.g. knowledge entry sourceKey). */
  sourceKey: string;
  /** Text content of the matched entry. */
  content: string;
  /** Relevance score in [0, 1]. Higher is more relevant. */
  score: number;
  /** ISO language tag of the content (e.g. 'zh-TW', 'en'). */
  language: string;
  /** True when the result was returned via cross-language fallback. */
  isCrossLanguageFallback?: boolean;
}

/**
 * A retrieval hit where at least one of `chunkId` or `knowledgeEntryId`
 * is present.  Use `ChunkResultWithChunkId` when the chunk PK is known,
 * `ChunkResultWithEntryId` when only the entry PK is available.
 */
export type ChunkResult = ChunkResultWithChunkId | ChunkResultWithEntryId;
