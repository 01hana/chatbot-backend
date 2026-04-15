/**
 * Result returned by SafetyService.scanPrompt().
 *
 * When `blocked` is true, the pipeline must short-circuit immediately and
 * return the appropriate refusal response without calling the LLM.
 */
export interface SafetyScanResult {
  /** Whether the input was blocked by any safety rule. */
  blocked: boolean;
  /**
   * The category that triggered the block.
   * Only present when `blocked` is true.
   */
  category?: SafetyBlockCategory;
  /** Human-readable reason for the block. */
  blockedReason?: string;
  /** SHA-256 hex digest of the raw input. Used for audit logging. */
  promptHash?: string;
}

/**
 * Enumeration of all possible block categories used in AuditLog.
 * Phase 3 will expand the detection logic for each category.
 */
export type SafetyBlockCategory =
  | 'prompt_injection'
  | 'jailbreak'
  | 'blacklist_keyword'
  | 'confidential_topic'
  | 'internal_topic';

/**
 * Result returned by SafetyService.checkConfidentiality().
 */
export interface ConfidentialityResult {
  /** Whether the input triggered a confidentiality block. */
  triggered: boolean;
  /** The classification type of the matched blacklist entry. */
  matchedType?: string;
  /** The keyword that was matched. */
  matchedKeyword?: string;
}
