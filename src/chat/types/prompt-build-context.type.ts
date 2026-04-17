import { KnowledgeEntry } from '../../generated/prisma/client';
import { LlmMessage } from '../../llm/types/llm.types';
import { ConversationMessageLike } from '../../intent/types/intent-detect-result.type';

/**
 * All the information PromptBuilder needs to assemble the full LLM message list.
 */
export interface PromptBuildContext {
  /** User's current input message. */
  userMessage: string;
  /** Detected language: "zh-TW" | "en" */
  language: string;
  /** RAG results to inject as context (may be empty). */
  knowledgeEntries: KnowledgeEntry[];
  /** Recent conversation history (user + assistant turns). */
  conversationHistory: ConversationMessageLike[];
  /**
   * Maximum total tokens allowed in the assembled prompt.
   * Loaded from SystemConfig `llm_max_context_tokens`.
   */
  maxContextTokens: number;
  /**
   * RAG confidence level for this turn.
   * - 'high': top score >= rag_answer_threshold → normal answer
   * - 'low':  score between rag_minimum_score and rag_answer_threshold → cautious reply
   * - undefined: not evaluated (e.g. degraded mode)
   */
  confidenceLevel?: 'high' | 'low';
}

/**
 * Output of PromptBuilder.build() — ready-to-send message list.
 */
export interface BuiltPrompt {
  messages: LlmMessage[];
  /** Estimated token count (rough character-based approximation). */
  estimatedTokens: number;
}
