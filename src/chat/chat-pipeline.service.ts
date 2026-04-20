import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { franc } from 'franc';
import { Conversation, ConversationMessage } from '../generated/prisma/client';
import { SafetyService } from '../safety/safety.service';
import { IntentService } from '../intent/intent.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ConversationService } from '../conversation/conversation.service';
import { AiStatusService } from '../health/ai-status.service';
import { LlmTimeoutError } from '../llm/errors/llm-timeout.error';
import { ILlmProvider, LLM_PROVIDER } from '../llm/interfaces/llm-provider.interface';
import {
  IRetrievalService,
  RETRIEVAL_SERVICE,
} from '../retrieval/interfaces/retrieval-service.interface';
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
  /** RAG confidence level, set in step 7. */
  confidenceLevel: 'high' | 'low' | 'none';
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
 *  7. evaluateConfidence   — dual threshold: minimum score vs answer threshold
 *  8. buildPrompt          — PromptBuilder.build() with confidenceLevel
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
      confidenceLevel: 'none',
    };

    try {
      // ── Step 1: Validate ────────────────────────────────────────────────
      const maxLen = this.systemConfigService.getNumber('max_message_length') ?? 2000;
      if (!this.validateInput(userMessage, maxLen)) {
        this.writeSseAndEnd(res, 'error', {
          code: 'MESSAGE_TOO_LONG',
          message: `最大長度 ${maxLen} 字元`,
        } satisfies SseErrorPayload);
        return;
      }

      // ── Step 2: Language detection ──────────────────────────────────────
      ctx.language = this.detectLanguage(userMessage, conversation.language);

      // ── Step 3: PromptGuard ─────────────────────────────────────────────
      const guardResult = await this.runPromptGuard(userMessage);
      // promptHash is always computed in Phase 3 (returned even when not blocked)
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

        // T3-003: increment sensitiveIntentCount for adversarial categories + check alert
        const isSensitive = this.isSensitiveCategory(guardResult.category);
        let includeHandoff = false;
        if (isSensitive) {
          includeHandoff = await this.incrementAndCheckSensitiveIntent(
            conversation,
            requestId,
            startMs,
          );
        }

        // Build refusal — optionally append handoff guidance when threshold reached
        const refusal =
          this.safetyService.buildRefusalResponse(ctx.language) +
          (includeHandoff ? ' ' + this.safetyService.buildHandoffGuidance(ctx.language) : '');

        // Persist user message (blocked) + fixed refusal assistant message
        const userMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'user',
          content: userMessage,
          type: 'blocked',
          riskLevel: isSensitive ? 'high' : undefined,
          blockedReason: guardResult.blockedReason,
        });

        const assistantMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'assistant',
          content: refusal,
          type: 'blocked',
          riskLevel: isSensitive ? 'high' : undefined,
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
      // Checks BlacklistEntry type='confidential'/'internal'.  These are NOT
      // covered by scanPrompt() so that a distinct `confidential_refused` audit
      // event can be written here (rather than `prompt_guard_blocked`).
      const confidentialResult = await this.checkConfidentiality(userMessage);
      if (confidentialResult.triggered) {
        // Mark conversation as confidential/high-risk (T3-002)
        await this.conversationService.updateConversation(conversation.sessionId, {
          type: 'confidential',
          riskLevel: 'high',
        });

        // T3-003: increment count + check alert threshold
        const includeHandoff = await this.incrementAndCheckSensitiveIntent(
          conversation,
          requestId,
          startMs,
        );

        // Build refusal — optionally append handoff guidance
        const confidentialRefusal =
          this.safetyService.buildRefusalResponse(ctx.language) +
          (includeHandoff ? ' ' + this.safetyService.buildHandoffGuidance(ctx.language) : '');

        // Persist messages with confidential type/riskLevel (T3-002)
        const userMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'user',
          content: userMessage,
          type: 'confidential',
          riskLevel: 'high',
          blockedReason: `Confidential topic: ${confidentialResult.matchedKeyword ?? 'unknown'}`,
        });

        const assistantMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'assistant',
          content: confidentialRefusal,
          type: 'confidential',
          riskLevel: 'high',
        });

        // T3-005: write confidential_refused audit event
        await this.auditService.log({
          requestId,
          sessionId: conversation.sessionId,
          eventType: 'confidential_refused',
          blockedReason: `Confidential topic: ${confidentialResult.matchedKeyword ?? 'unknown'}`,
          promptHash: ctx.promptHash,
          eventData: {
            category: confidentialResult.matchedType,
            matchedKeyword: confidentialResult.matchedKeyword,
            type: 'confidential',
            riskLevel: 'high',
          },
          durationMs: Date.now() - startMs,
        });

        res.write(formatSseEvent('token', { token: confidentialRefusal } satisfies SseTokenPayload));
        this.writeSseAndEnd(res, 'done', {
          messageId: assistantMsg.id,
          action: 'intercepted' satisfies ChatAction,
          sourceReferences: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        } satisfies SseDonePayload);

        void userMsg;
        return;
      }

      // ── Step 5: Intent detection ─────────────────────────────────────────
      ctx.history = await this.conversationService.getHistoryByToken(conversation.session_token);
      const intentResult = await this.detectIntent(userMessage, ctx.language);
      ctx.intentLabel = intentResult.intentLabel;

      // ── Step 6: RAG retrieval ─────────────────────────────────────────────
      ctx.ragResults = await this.retrieveKnowledge(userMessage, ctx.intentLabel);
      ctx.ragConfidence = ctx.ragResults[0]?.score ?? 0;

      // ── Step 7: Confidence evaluation ────────────────────────────────────
      // Two thresholds:
      //   rag_minimum_score    (default 0.25): below this → no useful context → direct fallback
      //   rag_answer_threshold (default 0.55): above this → high confidence → normal LLM answer
      //                                        between the two → low confidence → LLM with cautious prompt
      // `rag_confidence_threshold` is kept as a backward-compatible alias for rag_answer_threshold.
      const minimumScore = this.systemConfigService.getNumber('rag_minimum_score') ?? 0.25;
      const answerThreshold =
        this.systemConfigService.getNumber('rag_answer_threshold') ??
        this.systemConfigService.getNumber('rag_confidence_threshold') ??
        0.55;

      const hasHits = ctx.ragResults.length > 0;
      const topScore = ctx.ragConfidence; // = ragResults[0]?.score ?? 0

      if (!hasHits || topScore < minimumScore) {
        // No hits or below minimum score → user needs to leave contact info or talk to sales
        const fallback = ctx.language === 'en'
          ? 'I couldn\'t find relevant information in our knowledge base. Please leave your contact details and our team will follow up.'
          : '抱歉，我在知識庫中找不到相關資訊。請留下您的聯絡資料，我們的業務人員將儘速與您聯繫。';

        const userMsg = await this.conversationService.addMessage(conversation.id, { role: 'user', content: userMessage });
        const assistantMsg = await this.conversationService.addMessage(conversation.id, { role: 'assistant', content: fallback });

        await this.auditService.log({
          requestId,
          sessionId: conversation.sessionId,
          eventType: 'chat_response',
          eventData: { action: 'fallback', skipReason: 'no_rag_hits' },
          ragConfidence: topScore,
          durationMs: Date.now() - startMs,
          configSnapshot: { rag_minimum_score: minimumScore, rag_answer_threshold: answerThreshold },
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

      // Between minimum and answer threshold → low confidence: enter LLM with cautious prompt
      // At or above answer threshold → high confidence: normal LLM answer
      ctx.confidenceLevel = topScore < answerThreshold ? 'low' : 'high';

      // ── Step 8: Build prompt ─────────────────────────────────────────────
      const maxContextTokens = this.systemConfigService.getNumber('llm_max_context_tokens') ?? 8000;
      const { messages } = this.buildPrompt(userMessage, ctx, maxContextTokens);

      // ── Step 9: Stream LLM response ──────────────────────────────────────
      const userMsg = await this.conversationService.addMessage(conversation.id, {
        role: 'user',
        content: userMessage,
      });

      let fullContent = '';
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let llmError: Error | null = null;
      let modelUsed = 'unknown';
      let fallbackTriggered = false;
      let aiProvider = 'unknown';

      const llmStartMs = Date.now();

      try {
        for await (const chunk of this.llmProvider.stream({ messages }, abortSignal)) {
          if (abortSignal.aborted) break;

          if (chunk.done) {
            if (chunk.usage) {
              usage = chunk.usage;
            }
            if (chunk.modelUsed) {
              modelUsed = chunk.modelUsed;
            }
            if (chunk.fallbackTriggered !== undefined) {
              fallbackTriggered = chunk.fallbackTriggered;
            }
            if (chunk.provider) {
              aiProvider = chunk.provider;
            }
            break;
          }

          fullContent += chunk.token;
          res.write(formatSseEvent('token', { token: chunk.token } satisfies SseTokenPayload));
        }

        if (abortSignal.aborted) {
          this.writeSseAndEnd(res, 'interrupted', {
            message: '連線已中斷',
          } satisfies SseStatusPayload);
          return;
        }
      } catch (err) {
        llmError = err as Error;

        // ── Timeout (LlmTimeoutError) ─────────────────────────────────────
        if (err instanceof LlmTimeoutError) {
          this.aiStatusService.recordFailure();
          await this.auditService.log({
            requestId,
            sessionId: conversation.sessionId,
            eventType: 'llm_timeout',
            eventData: { message: (err as Error).message, fallbackTriggered: true },
            durationMs: Date.now() - startMs,
          });
          this.writeSseAndEnd(res, 'timeout', {
            message: 'AI 回應逾時，請稍後再試',
          } satisfies SseStatusPayload);
          void userMsg;
          return;
        }

        // ── Client abort / connection close ──────────────────────────────
        if ((err as NodeJS.ErrnoException).code === 'ABORT_ERR' || abortSignal.aborted) {
          this.writeSseAndEnd(res, 'interrupted', {
            message: '連線已中斷',
          } satisfies SseStatusPayload);
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

        this.writeSseAndEnd(res, 'error', {
          code: 'LLM_ERROR',
          message: (err as Error).message,
        } satisfies SseErrorPayload);
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

      const sourceRefs = ctx.ragResults.map(r => r.entry.id);
      await this.auditService.log({
        requestId,
        sessionId: conversation.sessionId,
        eventType: 'chat_response',
        eventData: { action: 'answer', intentLabel: ctx.intentLabel, fallbackTriggered, confidenceLevel: ctx.confidenceLevel },
        knowledgeRefs: sourceRefs.map(String),
        ragConfidence: ctx.ragConfidence,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        durationMs: Date.now() - startMs, // pipeline total; LLM-only duration tracked separately via llmDurationMs
        aiModel: modelUsed,
        aiProvider, // populated from the provider's done chunk
        configSnapshot: {
          rag_minimum_score: this.systemConfigService.getNumber('rag_minimum_score') ?? 0.25,
          rag_answer_threshold:
            this.systemConfigService.getNumber('rag_answer_threshold') ??
            this.systemConfigService.getNumber('rag_confidence_threshold') ??
            0.55,
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
      this.logger.error(
        `ChatPipeline unhandled error: ${(err as Error).message}`,
        (err as Error).stack,
      );
      await this.auditService.log({
        requestId,
        sessionId: conversation.sessionId,
        eventType: 'pipeline_error',
        eventData: { error: (err as Error).message },
        durationMs: Date.now() - startMs,
      });
      this.writeSseAndEnd(res, 'error', {
        code: 'INTERNAL_ERROR',
        message: '系統發生錯誤，請稍後再試',
      } satisfies SseErrorPayload);
    }
  }

  // ─── Pipeline steps (individually mockable) ───────────────────────────────

  validateInput(message: string, maxLen: number): boolean {
    return typeof message === 'string' && message.trim().length > 0 && message.length <= maxLen;
  }

  /**
   * Step 2: language detection using `franc`.
   *
   * Maps franc ISO 639-3 codes to the two languages supported by the pipeline:
   *   - `cmn` / `zho` → `zh-TW`
   *   - `eng`         → `en`
   *   - anything else or `und` → `fallback` (default `zh-TW`)
   *
   * Extracted as a separate helper so unit tests can exercise it directly.
   */
  detectLanguage(input: string, fallback: string): string {
    return ChatPipelineService.detectLang(input, fallback);
  }

  /**
   * Static helper — thin wrapper around `franc` so it can be unit-tested
   * without constructing the full service.
   */
  static detectLang(input: string, fallback = 'zh-TW'): string {
    if (!input || input.trim().length === 0) return fallback;
    const code = franc(input, { minLength: 3 });
    if (code === 'cmn' || code === 'zho') return 'zh-TW';
    if (code === 'eng') return 'en';
    // For very short or ambiguous text, fall back to a CJK heuristic
    const cjkCount = (input.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
    if (cjkCount / Math.max(input.length, 1) > 0.3) return 'zh-TW';
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
      knowledgeEntries: ctx.ragResults.map(r => r.entry),
      conversationHistory: ctx.history,
      maxContextTokens,      confidenceLevel: ctx.confidenceLevel === 'none' ? undefined : ctx.confidenceLevel,    });
  }

  // ─── T3-003 helpers ───────────────────────────────────────────────────────

  /**
   * Returns `true` when the given SafetyBlockCategory warrants incrementing
   * `sensitiveIntentCount` (i.e. the input was adversarial or confidential).
   */
  private isSensitiveCategory(category: string | undefined): boolean {
    return ['prompt_injection', 'jailbreak', 'confidential_topic', 'internal_topic'].includes(
      category ?? '',
    );
  }

  /**
   * Atomically increments `Conversation.sensitiveIntentCount` and, if the new
   * value meets or exceeds `sensitive_intent_alert_threshold`, writes a
   * `sensitive_intent_alert` AuditLog event.
   *
   * @returns `true` when the threshold was reached (caller should append handoff guidance).
   */
  private async incrementAndCheckSensitiveIntent(
    conversation: Conversation,
    requestId: string,
    startMs: number,
  ): Promise<boolean> {
    const updated = await this.conversationService.incrementSensitiveIntentCount(
      conversation.sessionId,
    );
    const threshold =
      this.systemConfigService.getNumber('sensitive_intent_alert_threshold') ?? 3;

    if (updated.sensitiveIntentCount >= threshold) {
      await this.auditService.log({
        requestId,
        sessionId: conversation.sessionId,
        eventType: 'sensitive_intent_alert',
        eventData: {
          sensitiveIntentCount: updated.sensitiveIntentCount,
          threshold,
        },
        durationMs: Date.now() - startMs,
      });
      return true;
    }
    return false;
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
    const fallback =
      language === 'en'
        ? (this.systemConfigService.get('fallback_message_en') ??
          'Service temporarily unavailable. Please leave your contact info.')
        : (this.systemConfigService.get('fallback_message_zh') ??
          '目前服務暫時無法使用，請留下聯絡資訊，我們將儘速回覆。');

    const userMsg = await this.conversationService.addMessage(conversation.id, {
      role: 'user',
      content: userMessage,
    });
    const assistantMsg = await this.conversationService.addMessage(conversation.id, {
      role: 'assistant',
      content: fallback,
    });

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
