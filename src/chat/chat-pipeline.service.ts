import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Conversation, ConversationMessage } from '../generated/prisma/client';
import { SafetyService } from '../safety/safety.service';
import { IntentService } from '../intent/intent.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ConversationService } from '../conversation/conversation.service';
import { AiStatusService } from '../health/ai-status.service';
import { ILlmProvider, LLM_PROVIDER } from '../llm/interfaces/llm-provider.interface';
import { IRetrievalService, RETRIEVAL_SERVICE } from '../retrieval/interfaces/retrieval-service.interface';
import { PromptBuilder } from './prompt-builder';
import {
  ChatAction,
  SseDonePayload,
  SseErrorPayload,
  SseStatusPayload,
  SseTokenPayload,
  formatSseEvent,
} from './types/sse-event.type';
import { RetrievalResult } from '../retrieval/types/retrieval.types';

/** Internal state threaded through the pipeline steps. */
interface PipelineContext {
  requestId: string;
  userMessage: string;
  conversation: Conversation;
  language: string;
  history: ConversationMessage[];
  ragResults: RetrievalResult[];
  intentLabel: string | null;
  ragConfidence: number;
  promptHash?: string;
}

/**
 * ChatPipelineService — orchestrates the 10-step chat pipeline.
 *
 * All steps are private methods so they can be individually mocked in tests.
 * The SSE stream is written directly to the Express `Response` object, bypassing
 * NestJS's response interceptor (which cannot be used with streaming responses).
 *
 * Pipeline steps:
 *  1. validateInput        — DTO-level length check
 *  2. detectLanguage       — franc / simple heuristic
 *  3. runPromptGuard       — SafetyService.scanPrompt()
 *  4. checkConfidentiality — SafetyService.checkConfidentiality()
 *  5. detectIntent         — IntentService.detect()
 *  6. retrieveKnowledge    — RetrievalService.retrieve()
 *  7. evaluateConfidence   — compare against rag_confidence_threshold
 *  8. buildPrompt          — PromptBuilder.build()
 *  9. callLlmStream        — ILlmProvider.stream()
 * 10. writeAndReturn       — persist messages + write AuditLog
 */
@Injectable()
export class ChatPipelineService {
  private readonly logger = new Logger(ChatPipelineService.name);
  private readonly llmProvider: ILlmProvider;
  private readonly retrievalService: IRetrievalService;

  constructor(
    private readonly safetyService: SafetyService,
    private readonly intentService: IntentService,
    private readonly systemConfigService: SystemConfigService,
    private readonly auditService: AuditService,
    private readonly conversationService: ConversationService,
    private readonly aiStatusService: AiStatusService,
    private readonly promptBuilder: PromptBuilder,
    @Inject(LLM_PROVIDER) llmProvider: unknown,
    @Inject(RETRIEVAL_SERVICE) retrievalService: unknown,
  ) {
    this.llmProvider = llmProvider as ILlmProvider;
    this.retrievalService = retrievalService as IRetrievalService;
  }

  /**
   * Entry point called by ChatController.
   * Writes SSE events directly to `res` and ends the response when done.
   */
  async run(
    conversation: Conversation,
    userMessage: string,
    requestId: string,
    res: Response,
    abortSignal: AbortSignal,
  ): Promise<void> {
    const startMs = Date.now();

    // ── Setup SSE headers ──────────────────────────────────────────────────
    this.setSseHeaders(res);

    // ── Degrade check — skip LLM, emit fallback immediately ───────────────
    if (this.aiStatusService.isDegraded()) {
      await this.streamFallbackResponse(conversation, userMessage, requestId, res, startMs);
      return;
    }

    const ctx: PipelineContext = {
      requestId,
      userMessage,
      conversation,
      language: conversation.language,
      history: [],
      ragResults: [],
      intentLabel: null,
      ragConfidence: 0,
    };

    try {
      // ── Step 1: Validate ────────────────────────────────────────────────
      const maxLen = this.systemConfigService.getNumber('max_message_length') ?? 2000;
      if (!this.validateInput(userMessage, maxLen)) {
        this.writeSseAndEnd(res, 'error', { code: 'MESSAGE_TOO_LONG', message: `最大長度 ${maxLen} 字元` } satisfies SseErrorPayload);
        return;
      }

      // ── Step 2: Language detection ──────────────────────────────────────
      ctx.language = this.detectLanguage(userMessage, conversation.language);

      // ── Step 3: PromptGuard ─────────────────────────────────────────────
      const guardResult = await this.runPromptGuard(userMessage);
      ctx.promptHash = guardResult.promptHash;

      if (guardResult.blocked) {
        await this.auditService.log({
          requestId,
          sessionId: conversation.sessionId,
          eventType: 'prompt_guard_blocked',
          blockedReason: guardResult.blockedReason,
          promptHash: guardResult.promptHash,
          eventData: { category: guardResult.category },
          durationMs: Date.now() - startMs,
        });

        // Persist user message (blocked) + fixed refusal assistant message
        const userMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'user', content: userMessage, type: 'blocked', blockedReason: guardResult.blockedReason,
        });

        const refusal = this.safetyService.buildRefusalResponse(ctx.language);
        const assistantMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'assistant', content: refusal, type: 'blocked',
        });

        res.write(formatSseEvent('token', { token: refusal } satisfies SseTokenPayload));
        this.writeSseAndEnd(res, 'done', {
          messageId: assistantMsg.id,
          action: 'intercepted' satisfies ChatAction,
          sourceReferences: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        } satisfies SseDonePayload);

        void userMsg; // used above
        return;
      }

      // ── Step 4: Confidentiality check ───────────────────────────────────
      const confidentialResult = await this.checkConfidentiality(userMessage);
      if (confidentialResult.triggered) {
        await this.conversationService.updateConversation(conversation.sessionId, {
          type: 'confidential',
          riskLevel: 'high',
        });
      }

      // ── Step 5: Intent detection ─────────────────────────────────────────
      ctx.history = await this.conversationService.getHistoryByToken(conversation.session_token);
      const intentResult = await this.detectIntent(userMessage, ctx.language);
      ctx.intentLabel = intentResult.intentLabel;

      // ── Step 6: RAG retrieval ─────────────────────────────────────────────
      ctx.ragResults = await this.retrieveKnowledge(userMessage, ctx.intentLabel);
      ctx.ragConfidence = ctx.ragResults[0]?.score ?? 0;

      // ── Step 7: Confidence evaluation ────────────────────────────────────
      const ragThreshold = this.systemConfigService.getNumber('rag_confidence_threshold') ?? 0.6;
      const skipLlm = ctx.ragResults.length > 0 && ctx.ragConfidence < ragThreshold;

      if (skipLlm) {
        // Low confidence — emit a generic fallback, no LLM call
        const fallback = ctx.language === 'en'
          ? 'I couldn\'t find specific information about your question. Please contact our sales team for assistance.'
          : '抱歉，我找不到與您問題相關的具體資訊。建議您直接聯繫業務人員以獲得更好的協助。';

        const userMsg = await this.conversationService.addMessage(conversation.id, { role: 'user', content: userMessage });
        const assistantMsg = await this.conversationService.addMessage(conversation.id, { role: 'assistant', content: fallback });

        await this.auditService.log({
          requestId,
          sessionId: conversation.sessionId,
          eventType: 'chat_response',
          eventData: { action: 'fallback', skipReason: 'low_rag_confidence' },
          ragConfidence: ctx.ragConfidence,
          durationMs: Date.now() - startMs,
          configSnapshot: { rag_confidence_threshold: ragThreshold },
        });

        res.write(formatSseEvent('token', { token: fallback } satisfies SseTokenPayload));
        this.writeSseAndEnd(res, 'done', {
          messageId: assistantMsg.id,
          action: 'fallback',
          sourceReferences: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        } satisfies SseDonePayload);

        void userMsg;
        return;
      }

      // ── Step 8: Build prompt ─────────────────────────────────────────────
      const maxContextTokens = this.systemConfigService.getNumber('llm_max_context_tokens') ?? 8000;
      const { messages } = this.buildPrompt(userMessage, ctx, maxContextTokens);

      // ── Step 9: Stream LLM response ──────────────────────────────────────
      const userMsg = await this.conversationService.addMessage(conversation.id, { role: 'user', content: userMessage });

      let fullContent = '';
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let llmError: Error | null = null;

      const llmStartMs = Date.now();

      try {
        for await (const chunk of this.llmProvider.stream({ messages }, abortSignal)) {
          if (abortSignal.aborted) break;

          if (chunk.done) {
            if (chunk.usage) {
              usage = chunk.usage;
            }
            break;
          }

          fullContent += chunk.token;
          res.write(formatSseEvent('token', { token: chunk.token } satisfies SseTokenPayload));
        }

        if (abortSignal.aborted) {
          this.writeSseAndEnd(res, 'interrupted', { message: '連線已中斷' } satisfies SseStatusPayload);
          return;
        }

      } catch (err) {
        llmError = err as Error;

        if ((err as NodeJS.ErrnoException).code === 'ABORT_ERR') {
          this.writeSseAndEnd(res, 'interrupted', { message: '連線已中斷' } satisfies SseStatusPayload);
          return;
        }

        // LLM error — record failure, emit error event
        this.aiStatusService.recordFailure();
        this.logger.warn(`LLM stream error: ${(err as Error).message}`);

        const isDegradedNow = this.aiStatusService.isDegraded();

        await this.auditService.log({
          requestId,
          sessionId: conversation.sessionId,
          eventType: isDegradedNow ? 'llm_degraded' : 'llm_error',
          eventData: { error: (err as Error).message, fallbackTriggered: true },
          durationMs: Date.now() - startMs,
        });

        this.writeSseAndEnd(res, 'error', { code: 'LLM_ERROR', message: (err as Error).message } satisfies SseErrorPayload);
        void userMsg;
        return;
      }

      // ── Step 10: Persist + close stream ──────────────────────────────────
      const llmDurationMs = Date.now() - llmStartMs;
      const assistantMsg = await this.conversationService.addMessage(conversation.id, {
        role: 'assistant',
        content: fullContent,
      });

      // LLM call succeeded — reset failure counter
      this.aiStatusService.recordSuccess();

      const sourceRefs = ctx.ragResults.map((r) => r.entry.id);
      await this.auditService.log({
        requestId,
        sessionId: conversation.sessionId,
        eventType: 'chat_response',
        eventData: { action: 'answer', intentLabel: ctx.intentLabel },
        knowledgeRefs: sourceRefs.map(String),
        ragConfidence: ctx.ragConfidence,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        durationMs: Date.now() - startMs,
        aiModel: 'mock', // replaced by real model in T2-004
        aiProvider: 'mock',
        configSnapshot: {
          rag_confidence_threshold: ragThreshold,
          llm_max_context_tokens: maxContextTokens,
        },
      });

      void llmError; // no-op — already handled above
      void llmDurationMs;

      this.writeSseAndEnd(res, 'done', {
        messageId: assistantMsg.id,
        action: 'answer' satisfies ChatAction,
        sourceReferences: sourceRefs,
        usage,
      } satisfies SseDonePayload);

    } catch (err) {
      this.logger.error(`ChatPipeline unhandled error: ${(err as Error).message}`, (err as Error).stack);
      await this.auditService.log({
        requestId,
        sessionId: conversation.sessionId,
        eventType: 'pipeline_error',
        eventData: { error: (err as Error).message },
        durationMs: Date.now() - startMs,
      });
      this.writeSseAndEnd(res, 'error', { code: 'INTERNAL_ERROR', message: '系統發生錯誤，請稍後再試' } satisfies SseErrorPayload);
    }
  }

  // ─── Pipeline steps (individually mockable) ───────────────────────────────

  validateInput(message: string, maxLen: number): boolean {
    return typeof message === 'string' && message.trim().length > 0 && message.length <= maxLen;
  }

  /**
   * Step 2: simple language detection.
   * A full `franc` integration would go here; for now we use a heuristic.
   * T2-004 refinement: install `franc` and use it here.
   */
  detectLanguage(input: string, fallback: string): string {
    // Heuristic: if the text contains mostly CJK characters, it's zh-TW
    const cjkCount = (input.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
    const ratio = cjkCount / Math.max(input.length, 1);
    if (ratio > 0.3) return 'zh-TW';
    if (/^[a-z0-9\s.,!?'"]+$/i.test(input)) return 'en';
    return fallback;
  }

  async runPromptGuard(input: string) {
    return this.safetyService.scanPrompt(input);
  }

  async checkConfidentiality(input: string) {
    return this.safetyService.checkConfidentiality(input);
  }

  async detectIntent(input: string, language: string) {
    return this.intentService.detect(input, language);
  }

  async retrieveKnowledge(query: string, intentLabel: string | null): Promise<RetrievalResult[]> {
    return this.retrievalService.retrieve({
      query,
      intentLabel: intentLabel ?? undefined,
      limit: 5,
    });
  }

  buildPrompt(userMessage: string, ctx: PipelineContext, maxContextTokens: number) {
    return this.promptBuilder.build({
      userMessage,
      language: ctx.language,
      knowledgeEntries: ctx.ragResults.map((r) => r.entry),
      conversationHistory: ctx.history,
      maxContextTokens,
    });
  }

  // ─── SSE helpers ──────────────────────────────────────────────────────────

  private setSseHeaders(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering
    res.flushHeaders();
  }

  private writeSseAndEnd(res: Response, event: string, data: unknown): void {
    res.write(formatSseEvent(event as Parameters<typeof formatSseEvent>[0], data));
    res.end();
  }

  // ─── Degraded mode fallback ───────────────────────────────────────────────

  private async streamFallbackResponse(
    conversation: Conversation,
    userMessage: string,
    requestId: string,
    res: Response,
    startMs: number,
  ): Promise<void> {
    const language = this.detectLanguage(userMessage, conversation.language);
    const fallback = language === 'en'
      ? (this.systemConfigService.get('fallback_message_en') ?? 'Service temporarily unavailable. Please leave your contact info.')
      : (this.systemConfigService.get('fallback_message_zh') ?? '目前服務暫時無法使用，請留下聯絡資訊，我們將儘速回覆。');

    const userMsg = await this.conversationService.addMessage(conversation.id, { role: 'user', content: userMessage });
    const assistantMsg = await this.conversationService.addMessage(conversation.id, { role: 'assistant', content: fallback });

    await this.auditService.log({
      requestId,
      sessionId: conversation.sessionId,
      eventType: 'llm_fallback',
      eventData: { reason: 'ai_degraded' },
      durationMs: Date.now() - startMs,
    });

    res.write(formatSseEvent('token', { token: fallback } satisfies SseTokenPayload));
    this.writeSseAndEnd(res, 'done', {
      messageId: assistantMsg.id,
      action: 'fallback' satisfies ChatAction,
      sourceReferences: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } satisfies SseDonePayload);

    void userMsg;
  }
}
