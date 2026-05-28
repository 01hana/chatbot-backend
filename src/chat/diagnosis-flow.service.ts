import { Injectable } from '@nestjs/common';
import type { Conversation, ConversationMessage } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { ConversationService } from '../conversation/conversation.service';
import { DiagnosisRecommendationService } from './diagnosis-recommendation.service';
import { DiagnosisService } from './diagnosis.service';
import { LeadPromptEnricherService } from './lead-prompt-enricher.service';
import type { SseDonePayload } from './types/sse-event.type';
import type { DiagnosisContext, DiagnosisFields } from './types/diagnosis-context.type';

export interface DiagnosisFlowInput {
  conversation: Conversation;
  userMessage: string;
  requestId: string;
  language: string;
  history: ConversationMessage[];
  intentLabel: string | null;
  abortSignal: AbortSignal;
  startMs: number;
}

export interface DiagnosisFlowResult {
  handled: boolean;
  reply?: string;
  donePayload?: SseDonePayload;
}

@Injectable()
export class DiagnosisFlowService {
  constructor(
    private readonly diagnosisService: DiagnosisService,
    private readonly diagnosisRecommendationService: DiagnosisRecommendationService,
    private readonly leadPromptEnricher: LeadPromptEnricherService,
    private readonly conversationService: ConversationService,
    private readonly auditService: AuditService,
  ) {}

  canHandle(intentLabel: string | null, diagnosisContext: DiagnosisContext | null): boolean {
    if (diagnosisContext?.stage === 'recommended') return false;

    return (
      intentLabel === 'product-diagnosis' ||
      diagnosisContext?.stage === 'collecting' ||
      diagnosisContext?.stage === 'complete'
    );
  }

  async handle(input: DiagnosisFlowInput): Promise<DiagnosisFlowResult> {
    const persistedDiagnosisContext =
      (input.conversation.diagnosisContext as DiagnosisContext | null) ?? null;

    if (!this.canHandle(input.intentLabel, persistedDiagnosisContext)) {
      return { handled: false };
    }

    const effectiveIntentLabel = 'product-diagnosis';
    let nextDiagnosisContext = this.diagnosisService.startOrContinue(persistedDiagnosisContext);

    const shouldProcessCurrentAnswer =
      persistedDiagnosisContext?.stage === 'collecting' &&
      nextDiagnosisContext.stage === 'collecting' &&
      nextDiagnosisContext.currentField !== undefined &&
      nextDiagnosisContext.currentField !== null;

    if (shouldProcessCurrentAnswer) {
      const currentField = nextDiagnosisContext.currentField;
      nextDiagnosisContext = this.diagnosisService.processAnswer(
        nextDiagnosisContext,
        currentField as keyof DiagnosisFields,
        input.userMessage,
      );
    }

    if (nextDiagnosisContext.stage !== 'complete') {
      const diagnosisReply = this.diagnosisService.getNextQuestion(
        nextDiagnosisContext,
        input.language,
      );
      const enrichedDiagnosisReply = await this.leadPromptEnricher.enrich({
        conversation: input.conversation,
        history: input.history,
        userMessage: input.userMessage,
        assistantContent: diagnosisReply,
        language: input.language,
        intentLabel: effectiveIntentLabel,
      });

      await this.conversationService.updateConversation(input.conversation.sessionId, {
        diagnosisContext:
          nextDiagnosisContext as unknown as Conversation['diagnosisContext'],
      });

      const userMsg = await this.conversationService.addMessage(input.conversation.id, {
        role: 'user',
        content: input.userMessage,
      });

      const assistantMsg = await this.conversationService.addMessage(input.conversation.id, {
        role: 'assistant',
        content: enrichedDiagnosisReply.content,
      });

      await this.auditService.log({
        requestId: input.requestId,
        sessionId: input.conversation.sessionId,
        eventType: 'diagnosis_progress',
        eventData: {
          action: 'diagnosis',
          stage: nextDiagnosisContext.stage,
          currentField: nextDiagnosisContext.currentField ?? null,
          collectedFields: nextDiagnosisContext.collectedFields,
          completedFields: this.getCompletedDiagnosisFields(nextDiagnosisContext),
          llmCalled: false,
          leadPrompted: enrichedDiagnosisReply.leadPrompted,
          highIntentScore: enrichedDiagnosisReply.highIntentResult.score,
          matchedHighIntentKeywords: enrichedDiagnosisReply.highIntentResult.matchedKeywords,
        },
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: Date.now() - input.startMs,
        llmCalled: false,
      });

      void userMsg;
      return {
        handled: true,
        reply: enrichedDiagnosisReply.content,
        donePayload: {
          messageId: assistantMsg.id,
          action: 'answer',
          intentLabel: effectiveIntentLabel,
          sourceReferences: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          leadPrompted: enrichedDiagnosisReply.leadPrompted,
        },
      };
    }

    const recommendation = await this.diagnosisRecommendationService.recommend({
      fields: nextDiagnosisContext.collectedFields,
      language: input.language,
      abortSignal: input.abortSignal,
      maxResults: 5,
    });

    const enrichedDiagnosisReply = await this.leadPromptEnricher.enrich({
      conversation: input.conversation,
      history: input.history,
      userMessage: input.userMessage,
      assistantContent: recommendation.reply,
      language: input.language,
      intentLabel: effectiveIntentLabel,
    });

    const nowIso = new Date().toISOString();
    const recommendedContext = {
      ...nextDiagnosisContext,
      stage: 'recommended',
      currentField: null,
      updatedAt: nowIso,
      recommendedAt: nowIso,
      matchedKnowledgeIds: recommendation.matchedKnowledgeIds,
      sourceReferences: recommendation.sourceReferences,
    } as unknown as DiagnosisContext;

    await this.conversationService.updateConversation(input.conversation.sessionId, {
      diagnosisContext: recommendedContext as unknown as Conversation['diagnosisContext'],
    });

    const userMsg = await this.conversationService.addMessage(input.conversation.id, {
      role: 'user',
      content: input.userMessage,
    });
    const assistantMsg = await this.conversationService.addMessage(input.conversation.id, {
      role: 'assistant',
      content: enrichedDiagnosisReply.content,
    });

    await this.auditService.log({
      requestId: input.requestId,
      sessionId: input.conversation.sessionId,
      eventType: 'diagnosis_recommended',
      eventData: {
        action: 'diagnosis_recommended',
        fields: nextDiagnosisContext.collectedFields,
        matchedKnowledgeIds: recommendation.matchedKnowledgeIds,
        sourceReferences: recommendation.sourceReferences,
        llmCalled: recommendation.llmCalled,
        answerMode: recommendation.answerMode,
        leadPrompted: enrichedDiagnosisReply.leadPrompted,
        highIntentScore: enrichedDiagnosisReply.highIntentResult.score,
        matchedHighIntentKeywords: enrichedDiagnosisReply.highIntentResult.matchedKeywords,
      },
      knowledgeRefs: recommendation.matchedKnowledgeIds.map(String),
      promptTokens: recommendation.usage.promptTokens,
      completionTokens: recommendation.usage.completionTokens,
      totalTokens: recommendation.usage.totalTokens,
      durationMs: Date.now() - input.startMs,
      llmCalled: recommendation.llmCalled,
      sourceReferences: recommendation.sourceReferences,
    });

    void userMsg;
    return {
      handled: true,
      reply: enrichedDiagnosisReply.content,
      donePayload: {
        messageId: assistantMsg.id,
        action: 'answer',
        intentLabel: effectiveIntentLabel,
        sourceReferences: recommendation.sourceReferences,
        usage: recommendation.usage,
        leadPrompted: enrichedDiagnosisReply.leadPrompted,
      },
    };
  }

  private getCompletedDiagnosisFields(context: DiagnosisContext): Array<keyof DiagnosisFields> {
    return (['purpose', 'material', 'length', 'environment'] as Array<keyof DiagnosisFields>).filter(
      field => {
        const value = context.collectedFields[field];
        return typeof value === 'string' && value.trim() !== '';
      },
    );
  }
}