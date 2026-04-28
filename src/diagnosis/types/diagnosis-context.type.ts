/**
 * DiagnosisQuestion — one step in a product-diagnosis conversation flow.
 *
 * Each question is identified by a `fieldKey` used as the key in
 * `collectedAnswers`. Both zh-TW and en variants are stored so the service
 * can return the appropriate language without additional lookups.
 */
export interface DiagnosisQuestion {
  /** Stable field identifier (e.g. 'material_preference', 'size_range'). */
  fieldKey: string;

  /** Question text in Traditional Chinese. */
  questionZh: string;

  /** Question text in English. */
  questionEn: string;

  /** Whether the user must answer before proceeding. */
  required: boolean;
}

/**
 * DiagnosisContext — the state machine snapshot persisted as JSONB in
 * `Conversation.diagnosisContext`.
 *
 * Phase 4 will extend this with richer fields (e.g. `completedAt`,
 * `recommendedProducts`). For now it holds only the minimal state needed
 * to drive the question-answer loop.
 */
export interface DiagnosisContext {
  /** Identifies the diagnosis flow (maps to an IntentTemplate key or config key). */
  flowId: string;

  /** Index of the next question to ask (number of questions already answered). */
  currentStep: number;

  /** Questions still waiting to be asked — shifts as answers are recorded. */
  pendingQuestions: DiagnosisQuestion[];

  /** Map of fieldKey → user answer, built up as the conversation progresses. */
  collectedAnswers: Record<string, string>;

  /** True once all required questions have been answered. */
  isComplete: boolean;
}
