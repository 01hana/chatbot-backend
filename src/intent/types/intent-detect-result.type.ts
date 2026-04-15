/**
 * Result returned by IntentService.detect().
 */
export interface IntentDetectResult {
  /** Detected intent label, e.g. "product-inquiry", "price-inquiry". */
  intentLabel: string | null;
  /**
   * Confidence score in [0, 1].
   * 0 means no intent matched; 1 means exact match.
   */
  confidence: number;
  /** Language passed through from the caller. */
  language: string;
}

/**
 * Minimal ConversationMessage shape required by IntentService.isHighIntent().
 *
 * Using a subset interface avoids a circular dependency with a full
 * ConversationMessage Prisma type (which doesn't exist until Phase 2).
 */
export interface ConversationMessageLike {
  role: string;
  content: string;
}
