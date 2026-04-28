import { Injectable, NotFoundException } from '@nestjs/common';
import { ConversationService } from '../conversation/conversation.service';
import type { IDiagnosisService } from './interfaces/diagnosis-service.interface';
import type { DiagnosisContext, DiagnosisQuestion } from './types/diagnosis-context.type';

/**
 * DiagnosisService — stateless NestJS service that drives the product-diagnosis
 * question-answer loop by reading and writing `DiagnosisContext` JSONB through
 * `ConversationService`.
 *
 * Responsibility boundary:
 *  - Owns the state-machine transitions (init → question → answer → complete).
 *  - Does NOT write to SSE streams (Chat Pipeline's responsibility).
 *  - Does NOT detect intents (IntentService's responsibility).
 *  - Does NOT access Prisma directly.
 *
 * Phase 4 will add a `DiagnosisFlow` configuration layer on top of this service
 * (sourcing questions from IntentTemplate or a config key). For 002 the caller
 * supplies the question list when calling `initFlow()`.
 */
@Injectable()
export class DiagnosisService implements IDiagnosisService {
  constructor(private readonly conversationService: ConversationService) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Initialise (or re-initialise) a diagnosis flow for a conversation.
   *
   * Overwrites any existing `diagnosisContext` snapshot.
   */
  async initFlow(
    conversationId: number,
    flowId: string,
    questions: DiagnosisQuestion[],
  ): Promise<void> {
    const context: DiagnosisContext = {
      flowId,
      currentStep: 0,
      pendingQuestions: [...questions],
      collectedAnswers: {},
      isComplete: questions.length === 0,
    };
    await this.conversationService.updateDiagnosisContext(conversationId, context);
  }

  /**
   * Return the next pending question text in the requested language.
   *
   * Returns `null` when:
   *  - The diagnosis flow has not been initialised.
   *  - There are no more pending questions (flow complete).
   */
  async getNextQuestion(
    conversationId: number,
    language: string,
  ): Promise<DiagnosisQuestion | null> {
    const ctx = await this.conversationService.getDiagnosisContext(conversationId);
    if (!ctx || ctx.isComplete || ctx.pendingQuestions.length === 0) {
      return null;
    }
    // Return the full question object; the caller can select the correct
    // language field (questionZh / questionEn).
    const question = ctx.pendingQuestions[0];
    // Surface the correct language text in a convenience `text` field is
    // intentionally NOT done here — callers should use questionZh / questionEn
    // directly so the type stays canonical.
    void language; // language param reserved for Phase 4 filtering
    return question;
  }

  /**
   * Record the user's answer for `fieldKey` and advance the state machine.
   *
   * Shifts the answered question off `pendingQuestions`, increments
   * `currentStep`, and sets `isComplete = true` when no questions remain.
   *
   * @throws NotFoundException when the conversation has no active diagnosis flow.
   */
  async recordAnswer(
    conversationId: number,
    fieldKey: string,
    answer: string,
  ): Promise<void> {
    const ctx = await this.conversationService.getDiagnosisContext(conversationId);
    if (!ctx) {
      throw new NotFoundException(
        `No diagnosis flow found for conversationId ${conversationId}`,
      );
    }

    const updated: DiagnosisContext = {
      ...ctx,
      collectedAnswers: { ...ctx.collectedAnswers, [fieldKey]: answer },
      pendingQuestions: ctx.pendingQuestions.filter((q) => q.fieldKey !== fieldKey),
      currentStep: ctx.currentStep + 1,
      isComplete: false,
    };
    updated.isComplete = updated.pendingQuestions.length === 0;

    await this.conversationService.updateDiagnosisContext(conversationId, updated);
  }

  /**
   * Returns `true` when all required questions have been answered.
   *
   * Returns `false` when the flow has not been initialised.
   */
  async isComplete(conversationId: number): Promise<boolean> {
    const ctx = await this.conversationService.getDiagnosisContext(conversationId);
    return ctx?.isComplete ?? false;
  }

  /**
   * Return the map of fieldKey → answer collected so far.
   *
   * Returns an empty object when the flow has not been initialised.
   */
  async getCollectedAnswers(conversationId: number): Promise<Record<string, string>> {
    const ctx = await this.conversationService.getDiagnosisContext(conversationId);
    return ctx?.collectedAnswers ?? {};
  }
}
