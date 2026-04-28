import type { DiagnosisContext, DiagnosisQuestion } from '../types/diagnosis-context.type';

/**
 * IDiagnosisService — contract for the product-diagnosis state machine.
 *
 * All methods operate on a `conversationId` (the integer PK of the
 * Conversation row) and delegate persistence to `ConversationService`.
 */
export interface IDiagnosisService {
  /**
   * Initialise (or re-initialise) a diagnosis flow for the given conversation.
   *
   * Creates a fresh `DiagnosisContext` with the supplied questions and writes
   * it into `Conversation.diagnosisContext`.
   */
  initFlow(
    conversationId: number,
    flowId: string,
    questions: DiagnosisQuestion[],
  ): Promise<void>;

  /**
   * Return the next pending question, rendered in the requested language.
   *
   * Returns `null` when the diagnosis flow is complete or has not yet been
   * initialised for this conversation.
   */
  getNextQuestion(
    conversationId: number,
    language: string,
  ): Promise<DiagnosisQuestion | null>;

  /**
   * Record the user's answer for the given field key and advance
   * `currentStep`.
   *
   * Sets `isComplete = true` when no pending questions remain.
   */
  recordAnswer(
    conversationId: number,
    fieldKey: string,
    answer: string,
  ): Promise<void>;

  /**
   * Returns `true` when all required questions have been answered.
   */
  isComplete(conversationId: number): Promise<boolean>;

  /**
   * Return the map of fieldKey → answer collected so far.
   *
   * Returns an empty object when the flow has not been initialised.
   */
  getCollectedAnswers(conversationId: number): Promise<Record<string, string>>;
}

/** DI injection token for IDiagnosisService. */
export const DIAGNOSIS_SERVICE_TOKEN = Symbol('IDiagnosisService');
