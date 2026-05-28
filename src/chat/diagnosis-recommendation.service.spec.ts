import type { KnowledgeEntry } from '../generated/prisma/client';
import type { ILlmProvider } from '../llm/interfaces/llm-provider.interface';
import type { IRetrievalService } from '../retrieval/interfaces/retrieval-service.interface';
import type { RetrievalResult } from '../retrieval/types/retrieval.types';
import { DiagnosisRecommendationService } from './diagnosis-recommendation.service';

describe('DiagnosisRecommendationService', () => {
  const makeEntry = (overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry =>
    ({
      id: 101,
      title: '戶外防水線材',
      content: '規格內容',
      intentLabel: 'product-spec',
      tags: ['室外', '線材'],
      status: 'approved',
      visibility: 'public',
      version: 1,
      language: 'zh-TW',
      aliases: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      sourceKey: 'KB-101',
      category: null,
      answerType: 'rag',
      templateKey: null,
      faqQuestions: [],
      crossLanguageGroupKey: null,
      structuredAttributes: null,
      ...overrides,
    }) as KnowledgeEntry;

  const makeResult = (
    score: number,
    entryOverrides: Partial<KnowledgeEntry> = {},
  ): RetrievalResult => ({
    entry: makeEntry(entryOverrides),
    score,
  });

  const makeLlm = (): jest.Mocked<ILlmProvider> =>
    ({
      chat: jest.fn(),
      stream: jest.fn(),
    } as unknown as jest.Mocked<ILlmProvider>);

  const makeRetrieval = (): jest.Mocked<IRetrievalService> =>
    ({
      retrieve: jest.fn(),
    } as unknown as jest.Mocked<IRetrievalService>);

  const makeService = (
    llmProvider: jest.Mocked<ILlmProvider>,
    retrievalService: jest.Mocked<IRetrievalService>,
  ): DiagnosisRecommendationService =>
    new DiagnosisRecommendationService(
      llmProvider as unknown,
      retrievalService as unknown,
    );

  it('uses intentLabel=product-spec and diagnosis ranking profile for retrieval', async () => {
    const llmProvider = makeLlm();
    const retrievalService = makeRetrieval();
    retrievalService.retrieve.mockResolvedValue([]);

    const service = makeService(llmProvider, retrievalService);
    await service.recommend({
      fields: {
        purpose: '照明',
        material: '鋁',
        length: '2m',
        environment: '室外',
      },
      language: 'zh-TW',
      abortSignal: new AbortController().signal,
      maxResults: 5,
    });

    expect(retrievalService.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        intentLabel: 'product-spec',
        language: 'zh-TW',
        limit: 5,
        rankingProfile: 'diagnosis',
      }),
    );
  });

  it('builds tags from purpose/material/length/environment', async () => {
    const llmProvider = makeLlm();
    const retrievalService = makeRetrieval();
    retrievalService.retrieve.mockResolvedValue([]);

    const service = makeService(llmProvider, retrievalService);
    await service.recommend({
      fields: {
        purpose: '  Lighting ',
        material: 'AL',
        length: '3M',
        environment: ' Outdoor ',
      },
      language: 'en',
      abortSignal: new AbortController().signal,
    });

    const tags = retrievalService.retrieve.mock.calls.map(call => call[0].tags?.[0]);
    expect(tags).toEqual(expect.arrayContaining(['lighting', 'al', '3m', 'outdoor']));
  });

  it('calls LLM when matches exist', async () => {
    const llmProvider = makeLlm();
    const retrievalService = makeRetrieval();
    retrievalService.retrieve.mockResolvedValue([makeResult(0.91)]);
    async function* stream() {
      yield { token: '建議方案A', done: false };
      yield {
        token: '',
        done: true,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      };
    }
    llmProvider.stream.mockReturnValue(stream());

    const service = makeService(llmProvider, retrievalService);
    const result = await service.recommend({
      fields: { purpose: '照明', material: '鋁', length: '2m', environment: '室外' },
      language: 'zh-TW',
      abortSignal: new AbortController().signal,
    });

    expect(llmProvider.stream).toHaveBeenCalled();
    expect(result.llmCalled).toBe(true);
    expect(result.answerMode).toBe('diagnosis_rag');
  });

  it('returns sourceReferences from matched entries', async () => {
    const llmProvider = makeLlm();
    const retrievalService = makeRetrieval();
    retrievalService.retrieve.mockResolvedValue([
      makeResult(0.91, { id: 901, sourceKey: 'KB-901' }),
    ]);
    async function* stream() {
      yield { token: '建議方案', done: false };
      yield {
        token: '',
        done: true,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    }
    llmProvider.stream.mockReturnValue(stream());

    const service = makeService(llmProvider, retrievalService);
    const result = await service.recommend({
      fields: { purpose: '照明', material: '鋁', length: '2m', environment: '室外' },
      language: 'zh-TW',
      abortSignal: new AbortController().signal,
    });

    expect(result.sourceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ knowledgeEntryId: 901, sourceKey: 'KB-901' }),
      ]),
    );
  });

  it('falls back and keeps sourceReferences when LLM fails', async () => {
    const llmProvider = makeLlm();
    const retrievalService = makeRetrieval();
    retrievalService.retrieve.mockResolvedValue([
      makeResult(0.8, { id: 202, title: '鋁製戶外線材', sourceKey: 'KB-202' }),
    ]);
    async function* broken() {
      throw new Error('llm failure');
    }
    llmProvider.stream.mockReturnValue(broken());

    const service = makeService(llmProvider, retrievalService);
    const result = await service.recommend({
      fields: { purpose: '照明', material: '鋁', length: '2m', environment: '室外' },
      language: 'zh-TW',
      abortSignal: new AbortController().signal,
    });

    expect(result.llmCalled).toBe(false);
    expect(result.answerMode).toBe('diagnosis_template_fallback');
    expect(result.reply).toContain('根據您的需求');
    expect(result.sourceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ knowledgeEntryId: 202, sourceKey: 'KB-202' }),
      ]),
    );
  });

  it('does not call LLM when there are no matches', async () => {
    const llmProvider = makeLlm();
    const retrievalService = makeRetrieval();
    retrievalService.retrieve.mockResolvedValue([]);

    const service = makeService(llmProvider, retrievalService);
    const result = await service.recommend({
      fields: { purpose: '照明', material: '鋁', length: '2m', environment: '室外' },
      language: 'zh-TW',
      abortSignal: new AbortController().signal,
    });

    expect(llmProvider.stream).not.toHaveBeenCalled();
    expect(result.reply).toContain('尚未找到足夠匹配的產品規格');
    expect(result.sourceReferences).toEqual([]);
  });

  it('returns usage from LLM done chunk', async () => {
    const llmProvider = makeLlm();
    const retrievalService = makeRetrieval();
    retrievalService.retrieve.mockResolvedValue([makeResult(0.95)]);
    async function* stream() {
      yield { token: 'Recommended spec.', done: false };
      yield {
        token: '',
        done: true,
        usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      };
    }
    llmProvider.stream.mockReturnValue(stream());

    const service = makeService(llmProvider, retrievalService);
    const result = await service.recommend({
      fields: { purpose: 'lighting', material: 'al', length: '2m', environment: 'outdoor' },
      language: 'en',
      abortSignal: new AbortController().signal,
    });

    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 8, totalTokens: 20 });
  });

  it('ensures LLM sees only selected matched entries, not independent matching', async () => {
    const llmProvider = makeLlm();
    const retrievalService = makeRetrieval();
    retrievalService.retrieve.mockResolvedValue([
      makeResult(0.9, { id: 1, title: 'A', sourceKey: 'A' }),
      makeResult(0.8, { id: 2, title: 'B', sourceKey: 'B' }),
      makeResult(0.7, { id: 3, title: 'C', sourceKey: 'C' }),
      makeResult(0.6, { id: 4, title: 'D', sourceKey: 'D' }),
    ]);
    async function* stream() {
      yield { token: 'ok', done: false };
      yield {
        token: '',
        done: true,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    }
    llmProvider.stream.mockReturnValue(stream());

    const service = makeService(llmProvider, retrievalService);
    await service.recommend({
      fields: { purpose: 'lighting', material: 'al', length: '2m', environment: 'outdoor' },
      language: 'en',
      abortSignal: new AbortController().signal,
    });

    const llmInput = llmProvider.stream.mock.calls[0]?.[0];
    expect(JSON.stringify(llmInput)).toContain('id=1');
    expect(JSON.stringify(llmInput)).toContain('id=2');
    expect(JSON.stringify(llmInput)).toContain('id=3');
    expect(JSON.stringify(llmInput)).not.toContain('id=4');
  });
});