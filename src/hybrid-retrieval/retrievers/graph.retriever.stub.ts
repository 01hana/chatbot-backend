import { Injectable } from '@nestjs/common';
import { ChunkResult } from '../types/chunk-result.type.js';
import { RetrievalPlan } from '../../query-understanding/types/retrieval-plan.type.js';
import { IGraphRetriever } from './graph.retriever.interface.js';

/**
 * GraphRetrieverStub — Phase 3 V1 placeholder.
 *
 * Always returns an empty array.  No Neo4j connection, no multi-hop graph
 * traversal, no complete GraphRAG.  A real implementation will replace this
 * in a future phase.
 */
@Injectable()
export class GraphRetrieverStub implements IGraphRetriever {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async retrieve(_plan: RetrievalPlan, _limit: number): Promise<ChunkResult[]> {
    return [];
  }
}
