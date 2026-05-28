/**
 * DiagnosisStage — lifecycle states for the product-diagnosis flow.
 *
 *   idle         → flow not yet started (initial state)
 *   collecting   → actively collecting answers from the user
 *   complete     → all required fields have been answered
 *   recommended  → recommendation has been delivered to the user
 */
export type DiagnosisStage = 'idle' | 'collecting' | 'complete' | 'recommended';

/**
 * DiagnosisFields — the four fixed fields collected during product diagnosis.
 *
 * Traversal order is always: purpose → material → length → environment.
 * Order is enforced by DiagnosisService.REQUIRED_FIELDS, not by the LLM.
 */
export interface DiagnosisFields {
  purpose: string;
  material: string;
  length: string;
  environment: string;
}

/**
 * DiagnosisContext — serialisable state stored in Conversation.diagnosisContext
 * (Prisma Json? column).
 *
 * All date/time fields are ISO-8601 strings so the value is safely round-tripped
 * through JSON without timezone loss.
 */
export interface DiagnosisContext {
  /** Current lifecycle stage of the diagnosis flow. */
  stage: DiagnosisStage;

  /** Fields answered so far. */
  collectedFields: Partial<DiagnosisFields>;

  /**
   * Ordered list of all required fields.
   * Always ['purpose', 'material', 'length', 'environment'].
   * Stored in context so consumers can iterate without importing constants.
   */
  requiredFields: Array<keyof DiagnosisFields>;

  /** The next field we are currently asking about, or null when complete. */
  currentField?: keyof DiagnosisFields | null;

  /** ISO-8601 timestamp when the diagnosis flow was first started. */
  startedAt?: string;

  /** ISO-8601 timestamp of the last state mutation. */
  updatedAt?: string;
}
