import { describe, beforeEach, it, expect } from '@jest/globals';
import { RetrievalFusionService } from './retrieval-fusion.service.js';
import type { ChunkResult } from '../types/chunk-result.type.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEntryChunk(id: number, score: number, extra: Partial<ChunkResult> = {}): ChunkResult {
  return {
    knowledgeEntryId: id,
    sourceKey: `key-${id}`,
    content: `content ${id}`,
    score,
    language: 'zh-TW',
    ...extra,
  };
}

function makeChunkIdChunk(chunkId: string, score: number, extra: Partial<ChunkResult> = {}): ChunkResult {
  return {
    chunkId,
    sourceKey: `src-${chunkId}`,
    content: `chunk content ${chunkId}`,
    score,
    language: 'zh-TW',
    ...extra,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RetrievalFusionService', () => {
  let service: RetrievalFusionService;

  beforeEach(() => {
    service = new RetrievalFusionService();
  });

  // ── Basic merging ─────────────────────────────────────────────────────────

  it('returns all results when all keys are unique', () => {
    const keyword = [makeEntryChunk(1, 0.8)];
    const vector = [makeEntryChunk(2, 0.7)];
    const graph = [makeEntryChunk(3, 0.6)];

    const result = service.fuse(keyword, vector, graph);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.knowledgeEntryId)).toEqual(
      expect.arrayContaining([1, 2, 3]),
    );
  });

  it('returns [] when all three sources are empty', () => {
    expect(service.fuse([], [], [])).toEqual([]);
  });

  it('handles one non-empty source correctly', () => {
    const keyword = [makeEntryChunk(1, 0.8), makeEntryChunk(2, 0.5)];

    const result = service.fuse(keyword, [], []);

    expect(result).toHaveLength(2);
  });

  // ── knowledgeEntryId deduplication ───────────────────────────────────────

  it('deduplicates by knowledgeEntryId, keeping the highest score', () => {
    const keyword = [makeEntryChunk(1, 0.6)];
    const vector = [makeEntryChunk(1, 0.9)];
    const graph = [makeEntryChunk(1, 0.4)];

    const result = service.fuse(keyword, vector, graph);

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.9);
  });

  it('deduplicates across keyword and vector with keyword winning', () => {
    const keyword = [makeEntryChunk(5, 0.8)];
    const vector = [makeEntryChunk(5, 0.3)];

    const result = service.fuse(keyword, vector, []);

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.8);
  });

  // ── chunkId deduplication ─────────────────────────────────────────────────

  it('deduplicates by chunkId, keeping the highest score', () => {
    const vector = [makeChunkIdChunk('chunk-abc', 0.7)];
    const graph = [makeChunkIdChunk('chunk-abc', 0.85)];

    const result = service.fuse([], vector, graph);

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.85);
  });

  it('treats chunkId and knowledgeEntryId as separate canonical keys', () => {
    const keyword = [makeEntryChunk(1, 0.6)];
    const vector = [makeChunkIdChunk('chunk-1', 0.7, { knowledgeEntryId: 1 })];

    // chunkId key = 'chunk-1', entry key = 'entry:1' — different canonical keys
    const result = service.fuse(keyword, vector, []);

    expect(result).toHaveLength(2);
  });

  // ── source merging correctness ────────────────────────────────────────────

  it('merges distinct entries from all three sources without loss', () => {
    const keyword = [makeEntryChunk(10, 0.9), makeEntryChunk(11, 0.7)];
    const vector = [makeChunkIdChunk('v-1', 0.6)];
    const graph = [makeChunkIdChunk('g-1', 0.5)];

    const result = service.fuse(keyword, vector, graph);

    expect(result).toHaveLength(4);
  });

  it('does not mutate the result for non-duplicate entries', () => {
    const chunk = makeEntryChunk(99, 0.5);
    const result = service.fuse([chunk], [], []);

    expect(result[0]).toEqual(chunk);
  });

  it('returns the higher-scoring object (not just its score) for duplicates', () => {
    const low = makeEntryChunk(7, 0.3, { content: 'low content' });
    const high = makeEntryChunk(7, 0.8, { content: 'high content' });

    const result = service.fuse([low], [high], []);

    expect(result[0].content).toBe('high content');
    expect(result[0].score).toBe(0.8);
  });
});
