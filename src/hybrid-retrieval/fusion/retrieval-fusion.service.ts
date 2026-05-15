import { Injectable } from '@nestjs/common';
import { ChunkResult } from '../types/chunk-result.type.js';

/**
 * RetrievalFusionService — merges results from multiple retriever sources.
 *
 * Phase 3 V1: fuses keyword + vector stub + graph stub.
 * When two sources return a hit for the same canonical key, the higher score
 * is retained and the lower-score entry is discarded.
 *
 * STRICT BOUNDARY: No tokenisation, linguistic analysis, or domain-signal
 * logic here.  Scoring is left unchanged — only deduplication is performed.
 */
@Injectable()
export class RetrievalFusionService {
  /**
   * Merge results from keyword, vector, and graph retrievers.
   *
   * Canonical key:
   *   - `r.chunkId` when present (KnowledgeChunk-based hit)
   *   - `entry:${r.knowledgeEntryId}` otherwise (KnowledgeEntry-based hit)
   *
   * For duplicate keys, the result with the higher score is kept.
   *
   * @returns Merged, deduplicated array (order not guaranteed — caller sorts).
   */
  fuse(
    keyword: ChunkResult[],
    vector: ChunkResult[],
    graph: ChunkResult[],
  ): ChunkResult[] {
    const best = new Map<string, ChunkResult>();

    for (const r of [...keyword, ...vector, ...graph]) {
      const key = this.canonicalKey(r);
      const existing = best.get(key);
      if (!existing || r.score > existing.score) {
        best.set(key, r);
      }
    }

    return Array.from(best.values());
  }

  /** Compute a stable deduplication key for a ChunkResult. */
  private canonicalKey(r: ChunkResult): string {
    return r.chunkId ?? `entry:${r.knowledgeEntryId}`;
  }
}
