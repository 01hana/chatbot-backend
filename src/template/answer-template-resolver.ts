import { Injectable } from '@nestjs/common';
import { IntentService } from '../intent/intent.service';
import { RetrievalResult } from '../retrieval/types/retrieval.types';
import { TemplateResolution } from './types/template-resolution.type';

/**
 * AnswerTemplateResolver — determines the answer strategy for a pipeline turn.
 *
 * Called after RAG retrieval (Step 6) and confidence evaluation (Step 7) so
 * that `ragResults` is already populated.  The resolver inspects the **top**
 * RAG result's `answerType` field and returns a `TemplateResolution` that
 * tells the pipeline whether to skip the LLM.
 *
 * ### Decision logic
 *
 * | `ragResults[0].entry.answerType` | strategy        | LLM called? |
 * |----------------------------------|-----------------|-------------|
 * | `'template'`                     | `template`      | No          |
 * | `'rag+template'`                 | `rag+template`  | No          |
 * | `'rag'` (default)                | `rag`           | Yes         |
 * | `'llm'`                          | `llm`           | Yes         |
 * | `ragResults` empty               | `llm`           | Yes         |
 *
 * The `template` and `rag+template` paths produce a deterministic
 * `resolvedContent` — the same input always produces the same output.
 *
 * ### rag+template fill logic
 *
 * When the top entry has `answerType='rag+template'` and an `intentLabel` is
 * present, the resolver looks up the matching `IntentTemplate` in the
 * IntentService in-memory cache, picks `templateZh` or `templateEn` based on
 * `language`, and replaces the `{content}` placeholder with the entry's
 * `content` field.  If no matching template is found, or the template has no
 * `{content}` placeholder, the entry content is appended after the template
 * text (or used directly as a fallback).
 */
@Injectable()
export class AnswerTemplateResolver {
  constructor(private readonly intentService: IntentService) {}

  /**
   * Determine the answer strategy for the current pipeline turn.
   *
   * This method is **synchronous** and **pure** (given the same inputs it
   * always returns the same result) — the in-memory template cache from
   * `IntentService` is treated as stable within a single request.
   *
   * @param ragResults  - Retrieval results from Step 6 (may be empty, but
   *                      in normal pipeline flow only called when score ≥ minimumScore).
   * @param intentLabel - Detected intent label from Step 5 (may be null).
   * @param language    - Detected language code (`'zh-TW'` | `'en'`).
   */
  resolve(
    ragResults: RetrievalResult[],
    intentLabel: string | null,
    language: string,
  ): TemplateResolution {
    // No RAG results → direct LLM (in practice the pipeline returns early before
    // calling resolve() when there are no hits, but guard here for safety)
    if (ragResults.length === 0) {
      return { strategy: 'llm', reason: 'no_rag_results' };
    }

    const topEntry = ragResults[0].entry;
    const answerType: string = topEntry.answerType ?? 'rag';
    const entryRef = topEntry.sourceKey ?? String(topEntry.id);

    switch (answerType) {
      case 'template': {
        // The knowledge entry's content IS the final answer — no LLM needed.
        return {
          strategy: 'template',
          resolvedContent: topEntry.content,
          reason: `template:${entryRef}`,
        };
      }

      case 'rag+template': {
        // Fill entry content into an IntentTemplate text and return.
        const resolvedContent = this.buildRagTemplate(
          topEntry.content,
          intentLabel,
          language,
        );
        return {
          strategy: 'rag+template',
          resolvedContent,
          reason: `rag+template:${entryRef}`,
        };
      }

      case 'llm': {
        // Explicitly marked as LLM-only — pass through to LLM path.
        return { strategy: 'llm', reason: `explicit_llm:${entryRef}` };
      }

      default: {
        // 'rag' (the default for all 001 entries) or any unrecognised value.
        return { strategy: 'rag', reason: `rag:${entryRef}` };
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Build the response for a `rag+template` knowledge entry.
   *
   * Lookup order:
   *  1. Find a cached IntentTemplate whose `label` matches `intentLabel` and
   *     whose `isActive` flag is true.
   *  2. Pick `templateZh` for `zh-TW` or `templateEn` for `en`.
   *  3. Replace the `{content}` placeholder in the template with the entry
   *     content.  If no placeholder exists, append the content after a blank
   *     line.
   *  4. If no matching active template is found, return `content` directly
   *     (safe fallback — still no LLM needed).
   */
  private buildRagTemplate(
    content: string,
    intentLabel: string | null,
    language: string,
  ): string {
    if (!intentLabel) return content;

    const templates = this.intentService.getCachedTemplates();
    const matched = templates.find(t => t.label === intentLabel && (t as { isActive?: boolean }).isActive !== false);
    if (!matched) return content;

    const templateText = language === 'en'
      ? (matched as { templateEn?: string }).templateEn
      : (matched as { templateZh?: string }).templateZh;

    if (!templateText) return content;

    if (templateText.includes('{content}')) {
      return templateText.replace('{content}', content);
    }

    // Template has no placeholder: append the entry content after a blank line
    return `${templateText}\n\n${content}`;
  }
}
