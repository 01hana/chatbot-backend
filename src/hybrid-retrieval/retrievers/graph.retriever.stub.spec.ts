import { describe, it, expect } from '@jest/globals';
import { GraphRetrieverStub } from './graph.retriever.stub.js';
import type { RetrievalPlan } from '../../query-understanding/types/retrieval-plan.type.js';

const PLAN: RetrievalPlan = {
  searchTerms: ['螺絲'],
  strategies: ['graph'],
  maxResults: 5,
  language: 'zh-TW',
};

describe('GraphRetrieverStub', () => {
  const stub = new GraphRetrieverStub();

  it('always returns an empty array', async () => {
    const result = await stub.retrieve(PLAN, 5);
    expect(result).toEqual([]);
  });

  it('does not throw for any plan or limit', async () => {
    await expect(stub.retrieve(PLAN, 0)).resolves.toEqual([]);
    await expect(stub.retrieve({ ...PLAN, searchTerms: [] }, 100)).resolves.toEqual([]);
  });

  it('returns a new empty array each call (no shared state)', async () => {
    const r1 = await stub.retrieve(PLAN, 5);
    const r2 = await stub.retrieve(PLAN, 5);
    expect(r1).not.toBe(r2);
    expect(r1).toHaveLength(0);
    expect(r2).toHaveLength(0);
  });
});
