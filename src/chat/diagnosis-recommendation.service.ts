import { Inject, Injectable } from '@nestjs/common';
import type { DiagnosisFields } from './types/diagnosis-context.type';
import type { SourceReference } from './types/source-reference.type';
import { ILlmProvider, LLM_PROVIDER } from '../llm/interfaces/llm-provider.interface';
import {
  IRetrievalService,
  RETRIEVAL_SERVICE,
} from '../retrieval/interfaces/retrieval-service.interface';
import type { RetrievalResult } from '../retrieval/types/retrieval.types';

export interface DiagnosisRecommendationInput {
  fields: Partial<DiagnosisFields>;
  language: string;
  abortSignal: AbortSignal;
  maxResults?: number;
}

export interface DiagnosisRecommendationResult {
  reply: string;
  matchedKnowledgeIds: number[];
  sourceReferences: SourceReference[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  llmCalled: boolean;
  answerMode: 'diagnosis_rag' | 'diagnosis_template_fallback';
}

@Injectable()
export class DiagnosisRecommendationService {
  private readonly llmProvider: ILlmProvider;
  private readonly retrievalService: IRetrievalService;

  constructor(
    @Inject(LLM_PROVIDER) llmProvider: unknown,
    @Inject(RETRIEVAL_SERVICE) retrievalService: unknown,
  ) {
    this.llmProvider = llmProvider as ILlmProvider;
    this.retrievalService = retrievalService as IRetrievalService;
  }

  async recommend(
    input: DiagnosisRecommendationInput,
  ): Promise<DiagnosisRecommendationResult> {
    const maxResults = input.maxResults ?? 5;
    const diagnosisMatches = await this.retrieveDiagnosisMatches(
      input.fields,
      input.language,
      maxResults,
    );
    const matchedResults = diagnosisMatches.slice(0, 3);
    const sourceReferences = this.buildDiagnosisSourceReferences(matchedResults);
    const matchedKnowledgeIds = matchedResults.map(result => result.entry.id);

    if (matchedResults.length === 0) {
      return {
        reply: this.buildDiagnosisNoMatchFallback(input.language),
        matchedKnowledgeIds: [],
        sourceReferences: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        llmCalled: false,
        answerMode: 'diagnosis_template_fallback',
      };
    }

    const diagnosisMessages = this.buildDiagnosisRecommendationMessages(
      input.fields,
      matchedResults,
      input.language,
    );

    let diagnosisReply = '';
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
      for await (const chunk of this.llmProvider.stream(
        { messages: diagnosisMessages },
        input.abortSignal,
      )) {
        if (chunk.done) {
          if (chunk.usage) usage = chunk.usage;
          break;
        }
        diagnosisReply += chunk.token;
      }

      if (diagnosisReply.trim() !== '') {
        return {
          reply: diagnosisReply,
          matchedKnowledgeIds,
          sourceReferences,
          usage,
          llmCalled: true,
          answerMode: 'diagnosis_rag',
        };
      }

      return {
        reply: this.buildDiagnosisTemplateFallback(
          input.fields,
          matchedResults,
          input.language,
        ),
        matchedKnowledgeIds,
        sourceReferences,
        usage,
        llmCalled: false,
        answerMode: 'diagnosis_template_fallback',
      };
    } catch {
      return {
        reply: this.buildDiagnosisTemplateFallback(
          input.fields,
          matchedResults,
          input.language,
        ),
        matchedKnowledgeIds,
        sourceReferences,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        llmCalled: false,
        answerMode: 'diagnosis_template_fallback',
      };
    }
  }

  private async retrieveDiagnosisMatches(
    collectedFields: Partial<DiagnosisFields>,
    language: string,
    maxResults: number,
  ): Promise<RetrievalResult[]> {
    const tags = [
      this.normalizeDiagnosisTag(collectedFields.purpose),
      this.normalizeDiagnosisTag(collectedFields.material),
      this.normalizeDiagnosisTag(collectedFields.length),
      this.normalizeDiagnosisTag(collectedFields.environment),
    ].filter((tag): tag is string => tag.length > 0);

    if (tags.length === 0) return [];

    const merged = new Map<number, RetrievalResult>();
    const baseQuery =
      this.buildDiagnosisQueryText(collectedFields) || 'product recommendation';

    for (const tag of tags) {
      const taggedResults = await this.retrievalService.retrieve({
        query: baseQuery,
        intentLabel: 'product-spec',
        tags: [tag],
        language,
        limit: maxResults,
        rankingProfile: 'diagnosis',
      });

      for (const result of taggedResults) {
        const existing = merged.get(result.entry.id);
        if (!existing || result.score > existing.score) {
          merged.set(result.entry.id, result);
        }
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  private normalizeDiagnosisTag(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase();
  }

  private buildDiagnosisQueryText(collectedFields: Partial<DiagnosisFields>): string {
    return [
      collectedFields.purpose,
      collectedFields.material,
      collectedFields.length,
      collectedFields.environment,
    ]
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.trim() !== '',
      )
      .join(' ');
  }

  private buildDiagnosisSourceReferences(results: RetrievalResult[]): SourceReference[] {
    return results.map((result, index) => ({
      knowledgeEntryId: result.entry.id,
      sourceKey: result.entry.sourceKey ?? '',
      language: result.entry.language,
      score: result.score,
      chunkIndex: index,
    }));
  }

  private buildDiagnosisRecommendationMessages(
    fields: Partial<DiagnosisFields>,
    results: RetrievalResult[],
    language: string,
  ): Array<{ role: 'system' | 'user'; content: string }> {
    const isEn = language === 'en';
    const fieldLines = [
      `purpose: ${fields.purpose ?? ''}`,
      `material: ${fields.material ?? ''}`,
      `length: ${fields.length ?? ''}`,
      `environment: ${fields.environment ?? ''}`,
    ].join('\n');

    const candidates = results
      .map(
        (result, index) =>
          `${index + 1}. id=${result.entry.id}, title=${result.entry.title}, score=${result.score.toFixed(3)}, tags=${result.entry.tags.join(',')}`,
      )
      .join('\n');

    return [
      {
        role: 'system',
        content: isEn
          ? 'You are a product recommendation assistant. Use ONLY the provided matched entries. Do not invent new matches. Provide concise recommendation with reasons.'
          : '你是產品規格推薦助手。只能使用提供的匹配條目，不可自行新增匹配。請提供精簡推薦與理由。',
      },
      {
        role: 'user',
        content: isEn
          ? `Diagnosis fields:\n${fieldLines}\n\nMatched entries:\n${candidates}\n\nPlease provide recommended products/specs, reasons, and if information is still insufficient suggest leaving contact details for sales follow-up.`
          : `問診欄位：\n${fieldLines}\n\n已匹配條目：\n${candidates}\n\n請整理推薦的產品/規格與推薦理由；若資訊仍不足，請提醒可留下聯絡方式由業務協助。`,
      },
    ];
  }

  private buildDiagnosisTemplateFallback(
    fields: Partial<DiagnosisFields>,
    results: RetrievalResult[],
    language: string,
  ): string {
    if (language === 'en') {
      const top = results
        .slice(0, 2)
        .map(result => result.entry.title)
        .join(', ');
      return `Based on your needs (purpose: ${fields.purpose ?? 'N/A'}, material: ${fields.material ?? 'N/A'}, length: ${fields.length ?? 'N/A'}, environment: ${fields.environment ?? 'N/A'}), we suggest: ${top || 'suitable product specifications in our catalog'}. If you need a more precise recommendation, please leave your contact details and our sales team will assist you.`;
    }

    const top = results
      .slice(0, 2)
      .map(result => result.entry.title)
      .join('、');
    return `根據您的需求（用途：${fields.purpose ?? '未提供'}、材質：${fields.material ?? '未提供'}、長度：${fields.length ?? '未提供'}、環境：${fields.environment ?? '未提供'}），建議可優先參考：${top || '符合條件的產品規格'}。若您需要更精準的建議，歡迎留下聯絡方式由業務協助您。`;
  }

  private buildDiagnosisNoMatchFallback(language: string): string {
    if (language === 'en') {
      return "Got it. We couldn't find a sufficiently matched product specification right now. Please leave your contact details and our sales team will help with a tailored recommendation.";
    }
    return '已收到您的需求，目前尚未找到足夠匹配的產品規格。建議您留下聯絡方式，由業務人員協助提供更精準的推薦。';
  }
}