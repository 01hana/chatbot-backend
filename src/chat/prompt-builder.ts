import { Injectable, Logger } from '@nestjs/common';
import { LlmMessage } from '../llm/types/llm.types';
import { PromptBuildContext, BuiltPrompt } from './types/prompt-build-context.type';
import { KnowledgeEntry } from '../generated/prisma/client';
import { ConversationMessageLike } from '../intent/types/intent-detect-result.type';

/**
 * PromptBuilder — assembles the final LLM message list from:
 *  1. A system prompt (language instruction + company persona)
 *  2. RAG knowledge context injected as a system message
 *  3. Recent conversation history (truncated to respect maxContextTokens)
 *  4. The current user message
 *
 * Token budget strategy:
 *  Rough approximation: 1 token ≈ 4 characters (English) / 2 characters (CJK).
 *  We use a conservative 3-char-per-token estimate for mixed content.
 *  When the accumulated history exceeds the budget, the oldest turns are
 *  dropped first (recency-biased truncation).
 */
@Injectable()
export class PromptBuilder {
  private readonly logger = new Logger(PromptBuilder.name);

  // ─── System Prompt Templates ──────────────────────────────────────────────

  private readonly SYSTEM_ZH = `你是震南鐵業的 AI 客服助理。你的職責是：
1. 用繁體中文回答客戶關於產品規格、報價、用途、材質等問題
2. 根據提供的知識庫內容提供準確的產品資訊
3. 若問題超出知識庫範圍，請誠實告知並建議客戶聯繫業務人員
4. 不得透露任何機密、定價策略或內部資訊
5. 回覆應簡潔、專業、有禮貌`;

  private readonly SYSTEM_EN = `You are an AI customer service assistant for Jenn-Nan Enterprise.
Your responsibilities:
1. Answer customer questions about product specifications, pricing, applications, and materials in English
2. Provide accurate product information based on the knowledge base provided
3. If a question is outside the knowledge base scope, honestly say so and suggest contacting a sales representative
4. Do not disclose any confidential information, pricing strategies, or internal data
5. Keep responses concise, professional, and polite`;

  // Low-confidence instruction injected as an additional system message
  private readonly LOW_CONFIDENCE_ZH =
    '⚠️ 提示：以下知識庫資訊與客戶問題的相關性可能不完整。' +
    '請優先追問客戶缺少的關鍵資訊（例如具體型號、應用場景、規格要求），' +
    '不要貿然給出不確定的答案。' +
    '若確實無法回答，請誠實告知並引導客戶聯繫業務人員。';

  private readonly LOW_CONFIDENCE_EN =
    '⚠️ Note: The knowledge base information below may only be partially relevant. ' +
    'Please ask the customer for clarifying details (e.g., specific model, use case, or specifications) ' +
    'before answering. Do not guess. ' +
    'If you cannot answer, honestly say so and direct the customer to a sales representative.';

  // Characters-per-token estimate (conservative for mixed CJK + English)
  private readonly CHARS_PER_TOKEN = 3;

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Build the complete message list ready to send to the LLM.
   *
   * @param context - All context required to assemble the prompt.
   * @returns       - Ordered LlmMessage array + estimated token count.
   */
  build(context: PromptBuildContext): BuiltPrompt {
    const systemPrompt = this.buildSystemPrompt(context.language);
    const ragContext = this.buildRagContext(context.knowledgeEntries, context.language);

    // Start building messages: system first
    const fixedMessages: LlmMessage[] = [{ role: 'system', content: systemPrompt }];
    if (ragContext) {
      fixedMessages.push({ role: 'system', content: ragContext });
    }
    // Inject low-confidence instruction when RAG confidence is marginal
    if (context.confidenceLevel === 'low') {
      const lowConfInstruction = context.language === 'en'
        ? this.LOW_CONFIDENCE_EN
        : this.LOW_CONFIDENCE_ZH;
      fixedMessages.push({ role: 'system', content: lowConfInstruction });
    }

    // Fixed token budget: system messages + current user message
    const fixedTokens = this.estimateTokens(
      fixedMessages.map((m) => m.content).join('') + context.userMessage,
    );
    const remainingBudget = Math.max(0, context.maxContextTokens - fixedTokens - 200); // 200-token buffer

    // Truncate history to fit budget (drop oldest turns first)
    const historyMessages = this.truncateHistory(context.conversationHistory, remainingBudget);

    const messages: LlmMessage[] = [
      ...fixedMessages,
      ...historyMessages,
      { role: 'user', content: context.userMessage },
    ];

    const estimatedTokens = this.estimateTokens(messages.map((m) => m.content).join(''));

    this.logger.debug(
      `PromptBuilder: ${messages.length} messages, ~${estimatedTokens} tokens ` +
        `(budget: ${context.maxContextTokens}, history turns: ${historyMessages.length})`,
    );

    return { messages, estimatedTokens };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private buildSystemPrompt(language: string): string {
    return language === 'en' ? this.SYSTEM_EN : this.SYSTEM_ZH;
  }

  private buildRagContext(entries: KnowledgeEntry[], language: string): string | null {
    if (!entries.length) return null;

    const header = language === 'en'
      ? '## Relevant product information from the knowledge base:\n\n'
      : '## 以下為知識庫中的相關產品資訊：\n\n';

    const items = entries
      .map((e, idx) => `[${idx + 1}] **${e.title}**\n${e.content}`)
      .join('\n\n');

    return header + items;
  }

  /**
   * Convert conversation history to LlmMessage array, truncated to fit budget.
   * Drops the oldest turns first.
   */
  private truncateHistory(
    history: ConversationMessageLike[],
    tokenBudget: number,
  ): LlmMessage[] {
    const mapped: LlmMessage[] = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Walk from newest to oldest, accumulating until budget is exhausted
    let accumulated = 0;
    let cutoff = mapped.length;

    for (let i = mapped.length - 1; i >= 0; i--) {
      const tokens = this.estimateTokens(mapped[i].content);
      if (accumulated + tokens > tokenBudget) {
        cutoff = i + 1;
        break;
      }
      accumulated += tokens;
      cutoff = i;
    }

    if (cutoff > 0) {
      this.logger.debug(`PromptBuilder: truncated ${cutoff} oldest history turns`);
    }

    return mapped.slice(cutoff);
  }

  /** Rough token count estimate: length / CHARS_PER_TOKEN. */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }
}
