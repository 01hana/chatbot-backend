import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Response } from 'express';
import { franc } from 'franc';
import { Conversation, ConversationMessage } from '../generated/prisma/client';
import type { KnowledgeEntry } from '../generated/prisma/client';
import { SafetyService } from '../safety/safety.service';
import { IntentService } from '../intent/intent.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import type {
  AuditQueryUnderstandingSummary,
  AuditChunkSummary,
  AuditRetrievalDecisionSummary,
} from '../audit/types/audit-log-v2-payload.type.js';
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
import { QueryAnalysisService } from '../query-analysis/query-analysis.service';
import type { AnalyzedQuery } from '../query-analysis/types/analyzed-query.type';
import { AnswerTemplateResolver } from '../template/answer-template-resolver';
import type { TemplateResolution } from '../template/types/template-resolution.type';
import type { QueryUnderstandingResult } from '../query-understanding/types/query-understanding-result.type.js';
import type { RetrievalDecision } from '../hybrid-retrieval/types/retrieval-decision.type.js';
import type { ChunkResult } from '../hybrid-retrieval/types/chunk-result.type.js';
import type { RetrievalPlan } from '../query-understanding/types/retrieval-plan.type.js';
import type { SourceReference } from './types/source-reference.type.js';
import type { AnswerMode } from './types/answer-mode.type.js';
import type { AnswerTrace } from './types/answer-trace.type.js';
import { QueryUnderstandingService } from '../query-understanding/query-understanding.service.js';
import { HybridRetrievalService } from '../hybrid-retrieval/hybrid-retrieval.service.js';
import { RetrievalDecisionService } from '../hybrid-retrieval/gate/retrieval-decision.service.js';

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
  /** True when RAG results came from cross-language fallback (no same-language hits). */
  isCrossLanguageFallback: boolean;
  /**
   * Structured query analysis output from QueryAnalysisService (QA-005).
   * Populated only when `feature.query_analysis_enabled` is true.
   * When absent, the pipeline uses the 001 behaviour (QueryNormalizer path).
   */
  analyzedQuery?: AnalyzedQuery;
  /**
   * Template resolution result, set in Step 9 (TM-002).
   * When strategy is 'template' or 'rag+template', the pipeline skips the LLM.
   */
  templateResolution?: TemplateResolution;
  /**
   * Query Understanding V2 result (QU-003).
   * Populated only when `feature.query_understanding_v2_enabled` is true.
   */
  queryUnderstandingResult?: QueryUnderstandingResult;
  /**
   * Retrieval decision from No-answer Gate (003).
   * Populated when `feature.no_answer_gate_enabled` or `feature.hybrid_retrieval_enabled` is true.
   */
  retrievalDecision?: RetrievalDecision;
  /**
   * Raw ChunkResult[] from the retrieval step (T070).
   * Set by the hybrid path directly; set via retrievalResultsToChunks() for the legacy path
   * when sourceReferences are needed (Phase 5-B).
   * Used by buildSourceReferences() to populate GeneratedAnswer.sourceReferences.
   */
  retrievedChunks?: ChunkResult[];
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
 * 2.5 analyzeQuery         — QueryAnalysisService.analyze() [feature flag: feature.query_analysis_enabled]
 *  3. runPromptGuard       — SafetyService.scanPrompt()
 *  4. checkConfidentiality — SafetyService.checkConfidentiality()
 *  5. detectIntent         — IntentService.detect() [passes analyzedQuery when available]
 *  6. retrieveKnowledge    — RetrievalService.retrieve() [passes rankingProfile/expandedTerms when available]
 *  7. evaluateConfidence   — dual threshold: minimum score vs answer threshold
 *  8. buildPrompt          — PromptBuilder.build() with confidenceLevel (skipped for template/rag+template)
 *  9. resolveTemplate      — AnswerTemplateResolver.resolve() [TM-002]
 *                            → template/rag+template: write resolvedContent, done, return (no LLM)
 *                            → rag/llm: continue to LLM stream
 * 10. callLlmStream        — ILlmProvider.stream()
 * 11. writeAndReturn       — persist messages + write AuditLog
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
    private readonly queryAnalysisService: QueryAnalysisService,
    private readonly templateResolver: AnswerTemplateResolver,
    @Inject(LLM_PROVIDER) llmProvider: unknown,
    @Inject(RETRIEVAL_SERVICE) retrievalService: unknown,
    // QU V2 (Phase 4-B): optional — not provided in legacy tests or when module is absent.
    @Optional()
    @Inject(QueryUnderstandingService)
    private readonly queryUnderstandingService?: QueryUnderstandingService,
    // Phase 4-C: optional — not provided when hybrid retrieval is disabled or in legacy tests.
    @Optional()
    @Inject(HybridRetrievalService)
    private readonly hybridRetrievalService?: HybridRetrievalService,
    @Optional()
    @Inject(RetrievalDecisionService)
    private readonly retrievalDecisionService?: RetrievalDecisionService,
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
      isCrossLanguageFallback: false,
    };

    try {
      const verboseAudit =
        this.systemConfigService.getBoolean('feature.audit_verbose_enabled') ?? false;

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

      // ── Step 2.5: Query analysis / understanding (feature flags) ──────────
      const quV2Enabled =
        this.systemConfigService.getBoolean('feature.query_understanding_v2_enabled') ?? false;
      const queryAnalysisEnabled =
        this.systemConfigService.getBoolean('feature.query_analysis_enabled') ?? false;

      if (quV2Enabled) {
        try {
          const quResult = await this.runQueryUnderstanding(userMessage, ctx.language);
          ctx.queryUnderstandingResult = quResult;
          ctx.analyzedQuery = this.adaptToAnalyzedQuery(quResult);
        } catch (err) {
          this.logger.warn(
            `QU V2 failed, falling back: ${(err as Error).message}`,
            (err as Error).stack,
          );
          // Fallback priority:
          //   feature.query_analysis_enabled=true  → fall back to QueryAnalysisService (002 path)
          //   feature.query_analysis_enabled=false → continue with no analyzedQuery (001 path)
          if (queryAnalysisEnabled) {
            ctx.analyzedQuery = await this.analyzeQuery(userMessage, ctx.language);
          }
        }
      } else if (queryAnalysisEnabled) {
        ctx.analyzedQuery = await this.analyzeQuery(userMessage, ctx.language);
      }

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
          intentLabel: null,
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

        res.write(
          formatSseEvent('token', { token: confidentialRefusal } satisfies SseTokenPayload),
        );
        this.writeSseAndEnd(res, 'done', {
          messageId: assistantMsg.id,
          action: 'intercepted' satisfies ChatAction,
          intentLabel: null,
          sourceReferences: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        } satisfies SseDonePayload);

        void userMsg;
        return;
      }

      // ── Step 5: Intent detection ─────────────────────────────────────────
      ctx.history = await this.conversationService.getHistoryByToken(conversation.session_token);
      const intentResult = await this.detectIntent(userMessage, ctx.language, ctx.analyzedQuery);
      ctx.intentLabel = intentResult.intentLabel;

      // ── Step 6: RAG retrieval ─────────────────────────────────────────────
      const hybridEnabled =
        this.systemConfigService.getBoolean('feature.hybrid_retrieval_enabled') ?? false;
      const gateEnabled =
        this.systemConfigService.getBoolean('feature.no_answer_gate_enabled') ?? false;
      const minScore = this.systemConfigService.getNumber('rag_minimum_score') ?? 0.25;

      if (hybridEnabled && ctx.queryUnderstandingResult && this.hybridRetrievalService) {
        // T060 — Hybrid path: HybridRetrievalService → decideFromChunks
        const chunks = await this.retrieveKnowledgeHybrid(
          ctx.queryUnderstandingResult.retrievalPlan,
          5,
        );
        ctx.retrievedChunks = chunks;
        ctx.ragResults = chunks.map(c => this.chunkToRetrievalResult(c));
        if (this.retrievalDecisionService) {
          ctx.retrievalDecision = this.retrievalDecisionService.decideFromChunks(
            chunks,
            ctx.queryUnderstandingResult,
            minScore,
          );
        }
      } else {
        // Legacy path (001/002): PostgresRetrievalService
        // Warn when hybrid was requested but the service was not injected.
        if (hybridEnabled && !this.hybridRetrievalService) {
          this.logger.warn(
            'feature.hybrid_retrieval_enabled=true but HybridRetrievalService is not injected; ' +
              'falling back to legacy retrieval.',
          );
        }
        ctx.ragResults = await this.retrieveKnowledge(
          userMessage,
          ctx.intentLabel,
          ctx.language,
          ctx.analyzedQuery,
        );
        // T061 — fill retrievalDecision from legacy results when gate is enabled
        if (gateEnabled && this.retrievalDecisionService) {
          ctx.retrievalDecision = this.retrievalDecisionService.decideFromRetrievalResults(
            ctx.ragResults,
            ctx.queryUnderstandingResult,
            minScore,
          );
        }
      }

      ctx.ragConfidence = ctx.ragResults[0]?.score ?? 0;
      ctx.isCrossLanguageFallback =
        ctx.ragResults.length > 0 && ctx.ragResults[0].isCrossLanguageFallback === true;

      // ── Step 6.5: No-answer Gate ─────────────────────────────────────
      // feature.no_answer_gate_enabled=false → skip (gateAllows=true, pipeline continues)
      // canAnswer=false → write fallback SSE, write AuditLog (llmCalled=false), return
      const gateAllows = await this.applyNoAnswerGate(
        ctx,
        gateEnabled,
        conversation,
        userMessage,
        requestId,
        res,
        startMs,
      );
      if (!gateAllows) return;

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
        const fallback =
          ctx.language === 'en'
            ? "I couldn't find relevant information in our knowledge base. Please leave your contact details and our team will follow up."
            : '抱歉，我在知識庫中找不到相關資訊。請留下您的聯絡資料，我們的業務人員將儘速與您聯繫。';

        const userMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'user',
          content: userMessage,
        });
        const assistantMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'assistant',
          content: fallback,
        });

        // await this.auditService.log({
        //   requestId,
        //   sessionId: conversation.sessionId,
        //   eventType: 'chat_response',
        //   eventData: { action: 'fallback', skipReason: 'no_rag_hits' },
        //   ragConfidence: topScore,
        //   durationMs: Date.now() - startMs,
        //   configSnapshot: { rag_minimum_score: minimumScore, rag_answer_threshold: answerThreshold },
        // });

        await this.auditService.log({
          requestId,
          sessionId: conversation.sessionId,
          eventType: 'chat_response',
          eventData: {
            action: 'fallback',
            skipReason: hasHits ? 'low_rag_confidence' : 'no_rag_hits',
            intentLabel: ctx.intentLabel,
            confidenceLevel: ctx.confidenceLevel,
            ...(ctx.analyzedQuery && {
              selectedProfile: ctx.analyzedQuery.selectedProfile,
              normalizedQuery: ctx.analyzedQuery.normalizedQuery,
              extractedTerms: ctx.analyzedQuery.terms,
              expandedTerms: ctx.analyzedQuery.expandedTerms,
              matchedQueryRules: ctx.analyzedQuery.matchedRules,
              queryAnalysisMs: ctx.analyzedQuery.debugMeta.processingMs,
            }),
          },
          ragConfidence: topScore,
          durationMs: Date.now() - startMs,
          configSnapshot: {
            rag_minimum_score: minimumScore,
            rag_answer_threshold: answerThreshold,
          },
          // V2 fields (T071)
          answerMode: 'fallback',
          sourceReferences: [],
          llmCalled: false,
          fallbackReason: hasHits ? 'low_rag_confidence' : 'no_rag_hits',
          canAnswer: ctx.retrievalDecision?.canAnswer,
          queryUnderstanding: this.buildAuditQueryUnderstanding(ctx.queryUnderstandingResult, verboseAudit),
          retrievalPlan: ctx.queryUnderstandingResult?.retrievalPlan,
          retrievalCandidates: [],
          retrievalDecision: this.buildAuditRetrievalDecision(ctx.retrievalDecision, verboseAudit),
          trace: this.buildAnswerTrace(ctx, startMs),
        });

        res.write(formatSseEvent('token', { token: fallback } satisfies SseTokenPayload));
        this.writeSseAndEnd(res, 'done', {
          messageId: assistantMsg.id,
          action: 'fallback',
          intentLabel: ctx.intentLabel,
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

      // ── Step 9: Template resolution (TM-002) ─────────────────────────────
      // Inspect the top RAG entry's answerType and decide whether we can skip
      // the LLM entirely.  For 'rag' and 'llm' strategies this is a no-op and
      // we fall through to the normal LLM streaming block below.
      ctx.templateResolution = this.resolveTemplate(ctx.ragResults, ctx.intentLabel, ctx.language);

      if (
        ctx.templateResolution.strategy === 'template' ||
        ctx.templateResolution.strategy === 'rag+template'
      ) {
        // Persist user message
        const userMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'user',
          content: userMessage,
        });

        const templateContent = ctx.templateResolution.resolvedContent!;

        // Persist assistant message (deterministic, no LLM)
        const assistantMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'assistant',
          content: templateContent,
        });

        const sourceRefs = ctx.ragResults.map(r => r.entry.id);
        const sourceReferences = this.buildSourceReferences(this.getCurrentChunksForSourceRefs(ctx));
        const answerMode = this.resolveAnswerMode(ctx, hybridEnabled, false);

        await this.auditService.log({
          requestId,
          sessionId: conversation.sessionId,
          eventType: 'chat_response',
          eventData: {
            action: 'answer',
            intentLabel: ctx.intentLabel,
            fallbackTriggered: false,
            confidenceLevel: ctx.confidenceLevel,
            templateStrategy: ctx.templateResolution.strategy,
            templateReason: ctx.templateResolution.reason,
            // QA-005 debug fields (when enabled)
            ...(ctx.analyzedQuery && {
              selectedProfile: ctx.analyzedQuery.selectedProfile,
              extractedTerms: ctx.analyzedQuery.terms,
              matchedQueryRules: ctx.analyzedQuery.matchedRules,
              queryAnalysisMs: ctx.analyzedQuery.debugMeta.processingMs,
            }),
          },
          knowledgeRefs: sourceRefs.map(String),
          ragConfidence: ctx.ragConfidence,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          durationMs: Date.now() - startMs,
          aiModel: 'none',
          aiProvider: 'template',
          configSnapshot: {
            rag_minimum_score: this.systemConfigService.getNumber('rag_minimum_score') ?? 0.25,
            rag_answer_threshold:
              this.systemConfigService.getNumber('rag_answer_threshold') ??
              this.systemConfigService.getNumber('rag_confidence_threshold') ??
              0.55,
            llm_max_context_tokens: maxContextTokens,
          },
          // V2 fields (T071)
          answerMode,
          sourceReferences,
          llmCalled: false,
          canAnswer: ctx.retrievalDecision?.canAnswer,
          queryUnderstanding: this.buildAuditQueryUnderstanding(ctx.queryUnderstandingResult, verboseAudit),
          retrievalPlan: ctx.queryUnderstandingResult?.retrievalPlan,
          retrievalCandidates: this.buildAuditRetrievalCandidates(this.getCurrentChunksForSourceRefs(ctx), verboseAudit),
          retrievalDecision: this.buildAuditRetrievalDecision(ctx.retrievalDecision, verboseAudit),
          trace: this.buildAnswerTrace(ctx, startMs),
        });

        // Write SSE token then done — LLM is NOT called
        res.write(formatSseEvent('token', { token: templateContent } satisfies SseTokenPayload));
        this.writeSseAndEnd(res, 'done', {
          messageId: assistantMsg.id,
          action: 'answer' satisfies ChatAction,
          intentLabel: ctx.intentLabel,
          sourceReferences: sourceReferences,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        } satisfies SseDonePayload);

        void userMsg;
        return;
      }

      // strategy === 'rag' or 'llm' → fall through to LLM streaming

      // ── Step 10: Stream LLM response ─────────────────────────────────────
      const userMsg = await this.conversationService.addMessage(conversation.id, {
        role: 'user',
        content: userMessage,
      });

      // T063 — Safety net: do NOT call LLM when gate is enabled and canAnswer=false.
      // applyNoAnswerGate() (Step 6.5) should have already blocked this path;
      // this guard provides defence-in-depth for edge cases.
      if (gateEnabled && ctx.retrievalDecision?.canAnswer !== true) {
        const gateFallbackContent = this.buildGateFallbackContent(ctx.language);
        const assistantMsg = await this.conversationService.addMessage(conversation.id, {
          role: 'assistant',
          content: gateFallbackContent,
        });
        await this.auditService.log({
          requestId,
          sessionId: conversation.sessionId,
          eventType: 'chat_response',
          eventData: {
            action: 'fallback',
            fallbackReason: ctx.retrievalDecision?.reason ?? 'no_results',
            canAnswer: false,
            llmCalled: false,
            intentLabel: ctx.intentLabel,
          },
          ragConfidence: ctx.ragConfidence,
          durationMs: Date.now() - startMs,
          // V2 fields (T071)
          answerMode: 'fallback',
          sourceReferences: [],
          llmCalled: false,
          canAnswer: false,
          fallbackReason: ctx.retrievalDecision?.reason ?? 'no_results',
          queryUnderstanding: this.buildAuditQueryUnderstanding(ctx.queryUnderstandingResult, verboseAudit),
          retrievalPlan: ctx.queryUnderstandingResult?.retrievalPlan,
          retrievalCandidates: [],
          retrievalDecision: this.buildAuditRetrievalDecision(ctx.retrievalDecision, verboseAudit),
          trace: this.buildAnswerTrace(ctx, startMs),
        });
        res.write(
          formatSseEvent('token', { token: gateFallbackContent } satisfies SseTokenPayload),
        );
        this.writeSseAndEnd(res, 'done', {
          messageId: assistantMsg.id,
          action: 'fallback' satisfies ChatAction,
          intentLabel: ctx.intentLabel,
          sourceReferences: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        } satisfies SseDonePayload);
        void userMsg;
        return;
      }

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
      const sourceReferences = this.buildSourceReferences(this.getCurrentChunksForSourceRefs(ctx));
      const answerMode = this.resolveAnswerMode(ctx, hybridEnabled, false);
      const trace = this.buildAnswerTrace(ctx, startMs, llmDurationMs);

      await this.auditService.log({
        requestId,
        sessionId: conversation.sessionId,
        eventType: 'chat_response',
        eventData: {
          action: 'answer',
          intentLabel: ctx.intentLabel,
          fallbackTriggered,
          confidenceLevel: ctx.confidenceLevel,
          // QA-005: include query analysis debug metadata when feature flag is on
          ...(ctx.analyzedQuery && {
            selectedProfile: ctx.analyzedQuery.selectedProfile,
            extractedTerms: ctx.analyzedQuery.terms,
            matchedQueryRules: ctx.analyzedQuery.matchedRules,
            queryAnalysisMs: ctx.analyzedQuery.debugMeta.processingMs,
          }),
        },
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
        // V2 fields (T071)
        answerMode,
        sourceReferences,
        llmCalled: true,
        canAnswer: ctx.retrievalDecision?.canAnswer,
        queryUnderstanding: this.buildAuditQueryUnderstanding(ctx.queryUnderstandingResult, verboseAudit),
        retrievalPlan: ctx.queryUnderstandingResult?.retrievalPlan,
        retrievalCandidates: this.buildAuditRetrievalCandidates(this.getCurrentChunksForSourceRefs(ctx), verboseAudit),
        retrievalDecision: this.buildAuditRetrievalDecision(ctx.retrievalDecision, verboseAudit),
        trace,
      });

      void llmError; // no-op — already handled above

      this.writeSseAndEnd(res, 'done', {
        messageId: assistantMsg.id,
        action: 'answer' satisfies ChatAction,
        intentLabel: ctx.intentLabel,
        sourceReferences: sourceReferences,
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
   *
   * Detection order (highest to lowest priority):
   *  1. Any CJK characters present → zh-TW  (fast, very reliable)
   *  2. Input is entirely ASCII printable chars → en
   *     Handles short product/FAQ terms: catalog, bolt, washer, wire, quote…
   *  3. `franc` ISO-639-3 mapping: cmn/zho → zh-TW, eng → en
   *  4. fallback (default: zh-TW)
   */
  static detectLang(input: string, fallback = 'zh-TW'): string {
    if (!input || input.trim().length === 0) return fallback;
    const trimmed = input.trim();

    // 1. Any CJK characters → Chinese (most reliable signal)
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(trimmed)) return 'zh-TW';

    // 2. Purely ASCII printable characters → English
    //    Covers single words (catalog, bolt, washer) and short phrases
    if (/^[\x20-\x7e]+$/.test(trimmed)) return 'en';

    // 3. Use franc for non-ASCII, non-CJK content (e.g. mixed scripts)
    const code = franc(trimmed, { minLength: 3 });
    if (code === 'cmn' || code === 'zho') return 'zh-TW';
    if (code === 'eng') return 'en';

    return fallback;
  }

  async runPromptGuard(input: string) {
    return this.safetyService.scanPrompt(input);
  }

  async checkConfidentiality(input: string) {
    return this.safetyService.checkConfidentiality(input);
  }

  async detectIntent(input: string, language: string, analyzedQuery?: AnalyzedQuery) {
    return this.intentService.detect(input, language, analyzedQuery);
  }

  /**
   * Step 2.5: analyse the raw user query and return a structured AnalyzedQuery.
   * Called only when `feature.query_analysis_enabled` is true (QA-005).
   */
  async analyzeQuery(input: string, language: string): Promise<AnalyzedQuery> {
    return this.queryAnalysisService.analyze(input, language);
  }

  /**
   * Step 2.5 (QU V2 path): Call QueryUnderstandingService.understand().
   * Called only when `feature.query_understanding_v2_enabled` is true.
   * Throws on error; the caller (run()) catches and falls back gracefully.
   */
  async runQueryUnderstanding(input: string, language: string): Promise<QueryUnderstandingResult> {
    if (!this.queryUnderstandingService) {
      throw new Error('QueryUnderstandingService not injected');
    }
    return this.queryUnderstandingService!.understand(input, language);
  }

  /**
   * Adapts a QueryUnderstandingResult (QU V2) to the AnalyzedQuery shape (QU 002).
   *
   * Pure format conversion — no DB access, no LLM calls.
   * Ensures downstream pipeline steps (IntentService, RetrievalService, AuditLog)
   * continue to operate correctly regardless of which analysis path was used.
   */
  private adaptToAnalyzedQuery(result: QueryUnderstandingResult): AnalyzedQuery {
    return {
      rawQuery: result.rawQuery,
      normalizedQuery: result.normalizedQuery,
      language: result.language,
      tokens: result.tokens.map(t => t.text),
      terms: result.keyPhrases.map(t => t.normalizedText),
      phrases: result.retrievalPlan.searchTerms,
      expandedTerms: result.retrievalPlan.searchTerms,
      matchedRules: [],
      selectedProfile: 'default',
      intentHints: [],
      debugMeta: {
        processingMs: result.debugMeta.durationMs,
        normalizerSteps: [],
        expansionHits: 0,
      },
    };
  }

  async retrieveKnowledge(
    query: string,
    intentLabel: string | null,
    language: string,
    analyzedQuery?: AnalyzedQuery,
  ): Promise<RetrievalResult[]> {
    return this.retrievalService.retrieve({
      // When analyzedQuery is available, use the normalised query to avoid double-normalisation
      query: analyzedQuery?.normalizedQuery ?? query,
      intentLabel: intentLabel ?? undefined,
      language,
      limit: 5,
      // QA-005: pass analysis metadata so retrieval can optionally use them
      rankingProfile: analyzedQuery?.selectedProfile,
      expandedTerms: analyzedQuery?.expandedTerms,
    });
  }

  /**
   * T060 — Hybrid retrieval path.
   * Delegates to HybridRetrievalService using the pre-computed RetrievalPlan
   * produced by QueryUnderstandingService.
   */
  async retrieveKnowledgeHybrid(plan: RetrievalPlan, limit: number): Promise<ChunkResult[]> {
    if (!this.hybridRetrievalService) throw new Error('HybridRetrievalService not injected');
    return this.hybridRetrievalService!.retrieve(plan, limit);
  }

  /**
   * T060 — Minimal adapter from ChunkResult to RetrievalResult.
   * Populates only the KnowledgeEntry fields actually used by the downstream
   * pipeline (PromptBuilder, TemplateResolver, source references).
   * All other Prisma model fields are set to safe defaults.
   */
  private chunkToRetrievalResult(chunk: ChunkResult): RetrievalResult {
    const entry = {
      id: chunk.knowledgeEntryId ?? 0,
      content: chunk.content,
      language: chunk.language,
      sourceKey: chunk.sourceKey || null,
      answerType: null,
      title: '',
      status: 'approved',
      visibility: 'public',
      version: 1,
      intentLabel: null,
      tags: [],
      aliases: [],
      category: null,
      templateKey: null,
      faqQuestions: [],
      crossLanguageGroupKey: null,
      structuredAttributes: null,
      deletedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as unknown as KnowledgeEntry;
    return { entry, score: chunk.score, isCrossLanguageFallback: chunk.isCrossLanguageFallback };
  }

  // ─── T062: No-answer Gate helpers ─────────────────────────────────────────

  /**
   * T062: Step 6.5 — No-answer gate.
   *
   * Returns `true` when the pipeline may continue, `false` when a fallback SSE
   * response has been written and the caller must return immediately.
   *
   * Behaviour by flag + state:
   *  - gateEnabled=false              → skip, return true
   *  - no retrievalDecision, results  → conservative allow, return true
   *  - no retrievalDecision, no results → fallback (no_results), return false
   *  - canAnswer=true                 → return true
   *  - canAnswer=false                → write fallback SSE + AuditLog, return false
   */
  private async applyNoAnswerGate(
    ctx: PipelineContext,
    gateEnabled: boolean,
    conversation: Conversation,
    userMessage: string,
    requestId: string,
    res: Response,
    startMs: number,
  ): Promise<boolean> {
    if (!gateEnabled) return true;

    // No retrievalDecision available — conservative: allow when there are RAG results,
    // but synthesise a decision so the T063 Step-10 guard can confirm canAnswer=true.
    if (!ctx.retrievalDecision) {
      if (ctx.ragResults.length > 0) {
        ctx.retrievalDecision = {
          canAnswer: true,
          reason: 'ok',
          confidence: ctx.ragConfidence,
          topK: [],
        };
        return true;
      }
      // No results and no decision → treat as blocked (no_results).
      await this.writeGateFallbackResponse(
        ctx,
        'no_results',
        conversation,
        userMessage,
        requestId,
        res,
        startMs,
      );
      return false;
    }

    if (!ctx.retrievalDecision.canAnswer) {
      await this.writeGateFallbackResponse(
        ctx,
        ctx.retrievalDecision.reason,
        conversation,
        userMessage,
        requestId,
        res,
        startMs,
      );
      return false;
    }

    return true;
  }

  /**
   * Persists messages, writes AuditLog, and emits the fallback SSE response
   * when the No-answer Gate blocks the pipeline.
   */
  private async writeGateFallbackResponse(
    ctx: PipelineContext,
    fallbackReason: string,
    conversation: Conversation,
    userMessage: string,
    requestId: string,
    res: Response,
    startMs: number,
  ): Promise<void> {
    const fallbackContent = this.buildGateFallbackContent(ctx.language);

    const userMsg = await this.conversationService.addMessage(conversation.id, {
      role: 'user',
      content: userMessage,
    });
    const assistantMsg = await this.conversationService.addMessage(conversation.id, {
      role: 'assistant',
      content: fallbackContent,
    });

    await this.auditService.log({
      requestId,
      sessionId: conversation.sessionId,
      eventType: 'chat_response',
      eventData: {
        action: 'fallback',
        fallbackReason,
        canAnswer: false,
        llmCalled: false,
        intentLabel: ctx.intentLabel,
      },
      ragConfidence: ctx.ragConfidence,
      durationMs: Date.now() - startMs,
      // V2 fields (T071)
      answerMode: 'fallback',
      sourceReferences: [],
      llmCalled: false,
      canAnswer: false,
      fallbackReason,
      queryUnderstanding: this.buildAuditQueryUnderstanding(
        ctx.queryUnderstandingResult,
        this.systemConfigService.getBoolean('feature.audit_verbose_enabled') ?? false,
      ),
      retrievalPlan: ctx.queryUnderstandingResult?.retrievalPlan,
      retrievalCandidates: [],
      retrievalDecision: this.buildAuditRetrievalDecision(
        ctx.retrievalDecision,
        this.systemConfigService.getBoolean('feature.audit_verbose_enabled') ?? false,
      ),
      trace: this.buildAnswerTrace(ctx, startMs),
    });

    res.write(formatSseEvent('token', { token: fallbackContent } satisfies SseTokenPayload));
    this.writeSseAndEnd(res, 'done', {
      messageId: assistantMsg.id,
      action: 'fallback' satisfies ChatAction,
      intentLabel: ctx.intentLabel,
      sourceReferences: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } satisfies SseDonePayload);

    void userMsg;
  }

  /**
   * Builds the language-appropriate fallback message used by the No-answer Gate.
   * Shared between applyNoAnswerGate (Step 6.5) and the T063 safety net (Step 10).
   */
  private buildGateFallbackContent(language: string): string {
    return language === 'en'
      ? "I couldn't find relevant information in our knowledge base. Please leave your contact details and our team will follow up."
      : '抱歉，我在知識庫中找不到相關資訊。請留下您的聯絡資料，我們的業務人員將儘速與您聯繫。';
  }

  /**
   * Step 9: Determine the answer strategy for this turn (TM-002).
   *
   * Delegates to AnswerTemplateResolver.  Extracted as a separate method so
   * it can be individually spied on in tests.
   */
  resolveTemplate(
    ragResults: RetrievalResult[],
    intentLabel: string | null,
    language: string,
  ): TemplateResolution {
    return this.templateResolver.resolve(ragResults, intentLabel, language);
  }

  /**
   * T070 — Map ChunkResult[] to SourceReference[] for traceability.
   *
   * - `chunkIndex` is the zero-based position in the input array.
   * - When `sourceKey` is absent on the chunk, falls back to an empty string.
   * - Passing an empty array returns an empty array (covers the `fallback` answerMode).
   * - Pure transform: no DB access, no retrieval, no LLM calls.
   */
  buildSourceReferences(chunks: ChunkResult[]): SourceReference[] {
    return chunks.map((chunk, index): SourceReference => {
      const chunkId: string | undefined = chunk.chunkId;
      const knowledgeEntryId: number | undefined = chunk.knowledgeEntryId;
      const base = {
        sourceKey: chunk.sourceKey ?? '',
        language: chunk.language,
        score: chunk.score,
        chunkIndex: index,
      };
      if (chunkId !== undefined) {
        return { ...base, chunkId, knowledgeEntryId };
      }
      // ChunkResultWithEntryId: knowledgeEntryId is guaranteed by the ChunkResult union.
      return { ...base, knowledgeEntryId: knowledgeEntryId! };
    });
  }

  /**
   * T070 — Minimal adapter from legacy RetrievalResult[] to ChunkResult[].
   *
   * Used by the legacy retrieval path to produce ChunkResult-like values that
   * buildSourceReferences() can consume.  Does NOT re-score, re-rank, or tokenise.
   */
  private retrievalResultsToChunks(results: RetrievalResult[]): ChunkResult[] {
    return results.map(r => ({
      knowledgeEntryId: r.entry.id,
      sourceKey: r.entry.sourceKey ?? '',
      content: r.entry.content,
      score: r.score,
      language: r.entry.language,
      isCrossLanguageFallback: r.isCrossLanguageFallback,
    }));
  }

  /**
   * T071 — Determine the AnswerMode that reflects the actual pipeline path taken.
   *
   * Called at each exit point; the result is stored in AuditLogV2Payload
   * and (when applicable) the SSE done payload for offline analysis.
   */
  private resolveAnswerMode(
    ctx: PipelineContext,
    hybridEnabled: boolean,
    isFallback: boolean,
  ): AnswerMode {
    if (isFallback) return 'fallback';
    const strategy = ctx.templateResolution?.strategy;
    if (strategy === 'template') return 'template';
    if (strategy === 'rag+template') return 'rag+template';
    // LLM path: hybrid_rag when chunks actually came from hybrid retrieval AND QU V2 produced a plan.
    if (ctx.retrievedChunks !== undefined && ctx.queryUnderstandingResult) return 'hybrid_rag';
    return 'llm';
  }

  /**
   * T071 — Return the ChunkResult array to pass to buildSourceReferences().
   *
   * Priority:
   *  1. isFallback=true    → [] (no sources available)
   *  2. ctx.retrievedChunks (hybrid path, set in Step 6) → use directly
   *  3. ctx.ragResults (legacy path) → adapt via retrievalResultsToChunks()
   */
  private getCurrentChunksForSourceRefs(
    ctx: PipelineContext,
    isFallback = false,
  ): ChunkResult[] {
    if (isFallback) return [];
    if (ctx.retrievedChunks !== undefined) return ctx.retrievedChunks;
    return this.retrievalResultsToChunks(ctx.ragResults);
  }

  /**
   * T071 — Build AnswerTrace timing/detail when feature.traceable_answer_enabled=true.
   *
   * Returns undefined when the flag is off so callers can pass the return
   * value directly into AuditLogV2Payload.trace without an extra check.
   * retrievalMs and fusionMs are 0 in V1 (no per-step stop-watch yet).
   */
  private buildAnswerTrace(
    ctx: PipelineContext,
    startMs: number,
    llmDurationMs?: number,
  ): AnswerTrace | undefined {
    const traceEnabled =
      this.systemConfigService.getBoolean('feature.traceable_answer_enabled') ?? false;
    if (!traceEnabled) return undefined;
    const chunks = this.getCurrentChunksForSourceRefs(ctx);
    const retrieverLabel = ctx.retrievedChunks !== undefined ? 'keyword' : 'legacy';
    return {
      queryUnderstandingMs: ctx.queryUnderstandingResult?.debugMeta?.durationMs ?? 0,
      retrievalMs: 0,
      fusionMs: 0,
      llmMs: llmDurationMs,
      totalMs: Date.now() - startMs,
      chunkDetails: chunks.map(c => ({
        chunkId: c.chunkId,
        knowledgeEntryId: c.knowledgeEntryId,
        score: c.score,
        retriever: retrieverLabel,
      })),
    };
  }

  // ─── Phase 5 slim-down audit helpers ─────────────────────────────────────

  /**
   * Convert a single ChunkResult to an audit-safe summary (no content field).
   * Used by buildAuditRetrievalDecision and buildAuditRetrievalCandidates.
   */
  private chunkToAuditSummary(chunk: ChunkResult): AuditChunkSummary {
    return {
      knowledgeEntryId: chunk.knowledgeEntryId,
      chunkId: chunk.chunkId,
      sourceKey: chunk.sourceKey,
      score: chunk.score,
      language: chunk.language,
    };
  }

  /**
   * Build the queryUnderstanding value for the audit log.
   * Default: slim summary (tokenizer/queryType/supportability/keyPhrases/durationMs).
   * Verbose (feature.audit_verbose_enabled=true): full QueryUnderstandingResult.
   */
  private buildAuditQueryUnderstanding(
    qu: QueryUnderstandingResult | undefined,
    verboseEnabled: boolean,
  ): AuditQueryUnderstandingSummary | QueryUnderstandingResult | undefined {
    if (!qu) return undefined;
    if (verboseEnabled) return qu;
    return {
      tokenizer: qu.tokenizer,
      queryType: qu.queryType,
      supportability: qu.supportability,
      keyPhrases: qu.keyPhrases.map(kp => kp.normalizedText),
      durationMs: qu.debugMeta.durationMs,
    };
  }

  /**
   * Build the retrievalDecision value for the audit log.
   * Default: slim summary with topK items stripped of content.
   * Verbose: full RetrievalDecision.
   */
  private buildAuditRetrievalDecision(
    decision: RetrievalDecision | undefined,
    verboseEnabled: boolean,
  ): AuditRetrievalDecisionSummary | RetrievalDecision | undefined {
    if (!decision) return undefined;
    if (verboseEnabled) return decision;
    return {
      canAnswer: decision.canAnswer,
      reason: decision.reason,
      confidence: decision.confidence,
      topK: decision.topK.map(c => this.chunkToAuditSummary(c)),
    };
  }

  /**
   * Build the retrievalCandidates array for the audit log.
   * Default: AuditChunkSummary[] (content stripped).
   * Verbose: full ChunkResult[].
   */
  private buildAuditRetrievalCandidates(
    chunks: ChunkResult[],
    verboseEnabled: boolean,
  ): AuditChunkSummary[] | ChunkResult[] {
    if (verboseEnabled) return chunks;
    return chunks.map(c => this.chunkToAuditSummary(c));
  }

  buildPrompt(userMessage: string, ctx: PipelineContext, maxContextTokens: number) {
    return this.promptBuilder.build({
      userMessage,
      language: ctx.language,
      knowledgeEntries: ctx.ragResults.map(r => r.entry),
      conversationHistory: ctx.history,
      maxContextTokens,
      confidenceLevel: ctx.confidenceLevel === 'none' ? undefined : ctx.confidenceLevel,
      isCrossLanguageFallback: ctx.isCrossLanguageFallback,
    });
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
    const threshold = this.systemConfigService.getNumber('sensitive_intent_alert_threshold') ?? 3;

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
      // V2 fields (T071)
      answerMode: 'fallback',
      sourceReferences: [],
      llmCalled: false,
      canAnswer: false,
      fallbackReason: 'ai_degraded',
      retrievalCandidates: [],
      trace: this.systemConfigService.getBoolean('feature.traceable_answer_enabled') ?? false
        ? { queryUnderstandingMs: 0, retrievalMs: 0, fusionMs: 0, totalMs: Date.now() - startMs, chunkDetails: [] }
        : undefined,
    });

    res.write(formatSseEvent('token', { token: fallback } satisfies SseTokenPayload));
    this.writeSseAndEnd(res, 'done', {
      messageId: assistantMsg.id,
      action: 'fallback' satisfies ChatAction,
      intentLabel: null,
      sourceReferences: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } satisfies SseDonePayload);

    void userMsg;
  }
}
