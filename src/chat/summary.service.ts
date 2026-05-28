import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuditLogV2Payload } from '../audit/types/audit-log-v2-payload.type';
import { LLM_PROVIDER } from '../llm/interfaces/llm-provider.interface';
import type { ILlmProvider } from '../llm/interfaces/llm-provider.interface';
import type { ConversationMessage } from '../generated/prisma/client';
import type { LlmChatRequest } from '../llm/types/llm.types';

type SummaryContext = {
  sessionId?: string;
  requestId?: string;
};

/**
 * SummaryService — produces a short conversation summary for the diagnosis /
 * high-intent follow-up flow.
 *
 * Behaviour:
 *  - Prefer an LLM-generated summary via ILlmProvider.chat().
 *  - Fall back to a deterministic template summary when the LLM fails or
 *    returns an empty response.
 *  - Never throws for LLM errors; the caller always receives a string.
 */
@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly llmProvider: ILlmProvider,
    private readonly auditService: AuditService,
  ) {}

  async generate(
    messages: ConversationMessage[],
    language: 'zh-TW' | 'en' | string,
    context?: SummaryContext,
  ): Promise<string> {
    const normalizedMessages = this.normalizeMessages(messages);
    if (normalizedMessages.length === 0) {
      const fallback = this.buildFallbackSummary([], language);
      await this.logSummaryFallback(context, 'no_messages');
      return fallback;
    }

    try {
      const response = await this.llmProvider.chat(this.buildChatRequest(normalizedMessages, language));
      const summary = response.content.trim();

      if (summary === '') {
        const fallback = this.buildFallbackSummary(normalizedMessages, language);
        await this.logSummaryFallback(context, 'empty_response');
        return fallback;
      }

      await this.logSummaryGenerated(context, normalizedMessages.length, response);
      return summary;
    } catch (error) {
      this.logger.warn(`SummaryService.generate fell back to template: ${(error as Error).message}`);
      const fallback = this.buildFallbackSummary(normalizedMessages, language);
      await this.logSummaryFallback(context, this.describeError(error));
      return fallback;
    }
  }

  private buildChatRequest(messages: string[], language: string): LlmChatRequest {
    const isZh = this.isZh(language);
    const transcript = messages
      .map((content, index) => `${index + 1}. ${content}`)
      .join('\n');

    const systemPrompt = isZh
      ? '你是客服摘要助手。請根據對話內容，摘要使用者需求。保留產品、規格、材質、尺寸、使用環境、報價意圖等重要資訊，不要加入不存在的資訊。請以繁體中文輸出，控制在 3 到 6 句。'
      : 'You are a customer-support summarizer. Summarize the user\'s needs from the conversation. Preserve product details, specifications, material, size, usage environment, and quote intent when present. Do not invent facts. Respond in English in 3 to 6 sentences.';

    const userPrompt = isZh
      ? `對話內容如下：\n${transcript}\n\n請輸出一段精簡摘要。`
      : `Conversation transcript:\n${transcript}\n\nPlease output a concise summary.`;

    return {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      maxTokens: 220,
    };
  }

  private buildFallbackSummary(messages: string[], language: string): string {
    const isZh = this.isZh(language);
    const recentMessages = messages.slice(-5).filter(content => content.trim() !== '');

    if (recentMessages.length === 0) {
      return isZh ? '尚無足夠對話內容可摘要。' : 'Not enough conversation content to summarize.';
    }

    const joined = isZh ? recentMessages.join('；') : recentMessages.join('; ');
    return isZh ? `使用者近期提到：${joined}` : `Recent user messages: ${joined}`;
  }

  private normalizeMessages(messages: ConversationMessage[]): string[] {
    return messages
      .map(message => message.content.trim())
      .filter(content => content !== '');
  }

  private isZh(language: string): boolean {
    return language.toLowerCase().startsWith('zh');
  }

  private describeError(error: unknown): string {
    if (error instanceof Error && error.message.trim() !== '') {
      return error.message;
    }
    return 'unknown_error';
  }

  private async logSummaryGenerated(
    context: SummaryContext | undefined,
    messageCount: number,
    response: { promptTokens: number; completionTokens: number; totalTokens: number; durationMs: number; model: string; provider: string },
  ): Promise<void> {
    await this.safeAuditLog({
      requestId: context?.requestId,
      sessionId: context?.sessionId,
      eventType: 'summary_generated',
      eventData: {
        action: 'summary',
        llmCalled: true,
        messageCount,
      },
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      totalTokens: response.totalTokens,
      durationMs: response.durationMs,
      aiModel: response.model,
      aiProvider: response.provider,
    });
  }

  private async logSummaryFallback(
    context: SummaryContext | undefined,
    reason: string,
  ): Promise<void> {
    await this.safeAuditLog({
      requestId: context?.requestId,
      sessionId: context?.sessionId,
      eventType: 'summary_fallback',
      eventData: {
        action: 'summary',
        llmCalled: false,
        reason,
      },
    });
  }

  private async safeAuditLog(event: AuditLogV2Payload): Promise<void> {
    try {
      await this.auditService.log(event);
    } catch (error) {
      this.logger.warn(`SummaryService audit log failed: ${(error as Error).message}`);
    }
  }
}