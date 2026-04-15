import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IntentTemplate, GlossaryTerm } from '../generated/prisma/client';
import { IntentRepository } from './intent.repository';
import {
  IntentDetectResult,
  ConversationMessageLike,
} from './types/intent-detect-result.type';

/**
 * IntentService — loads intent templates and glossary on startup; exposes
 * `detect()` and `isHighIntent()` consumed by the chat pipeline.
 *
 * Phase 1 status:
 *  - `loadCache()` and `invalidateCache()` are fully functional.
 *  - `detect()` is a Phase 1 skeleton — performs case-insensitive keyword
 *    matching against `IntentTemplate.keywords[]. Returns the highest-priority
 *    match or null. Full ML-based classification is out of scope.
 *  - `isHighIntent()` is a Phase 1 skeleton — returns false always.
 *    Phase 4 (T4-005) will implement the real rule-based scoring.
 */
@Injectable()
export class IntentService implements OnModuleInit {
  private readonly logger = new Logger(IntentService.name);

  /** In-memory copy of all intent templates (priority-ordered). */
  private templates: IntentTemplate[] = [];

  /** In-memory copy of all glossary terms. */
  private glossary: GlossaryTerm[] = [];

  constructor(private readonly intentRepository: IntentRepository) {}

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.loadCache();
  }

  // ─── Cache Management ─────────────────────────────────────────────────────

  /**
   * Load (or reload) all templates and glossary terms from the database.
   *
   * Called automatically on startup and by `invalidateCache()` after any
   * admin mutation to intent-related tables.
   */
  async loadCache(): Promise<void> {
    const [templates, glossary] = await Promise.all([
      this.intentRepository.findAllTemplates(),
      this.intentRepository.findAllGlossary(),
    ]);

    this.templates = templates;
    this.glossary = glossary;

    this.logger.log(
      `IntentService cache loaded: ${this.templates.length} templates, ${this.glossary.length} glossary terms`,
    );
  }

  /**
   * Force a full cache reload from the database.
   *
   * Must be called by admin endpoints after any CREATE / UPDATE / DELETE
   * on `intent_templates` or `glossary_terms`.
   */
  async invalidateCache(): Promise<void> {
    this.logger.log('IntentService cache invalidated — reloading from DB');
    await this.loadCache();
  }

  // ─── Cache Accessors (read-only snapshots for testing) ────────────────────

  getCachedTemplates(): Readonly<IntentTemplate[]> {
    return this.templates;
  }

  getCachedGlossary(): Readonly<GlossaryTerm[]> {
    return this.glossary;
  }

  // ─── Intent Detection ─────────────────────────────────────────────────────

  /**
   * Detect the intent of the user input using rule-based keyword matching.
   *
   * **Phase 1 skeleton** — uses `IntentTemplate.keywords` for keyword matching
   * only (case-insensitive, exact token). Templates are evaluated in
   * priority-descending order; the first match wins.
   *
   * Phase 2 (T2-007) will wire this into the Chat Pipeline.
   * Phase 4 (T4-005) will add high-intent scoring.
   *
   * @param input - Raw user message.
   * @param language - Detected language code (e.g. "zh-TW", "en").
   * @returns IntentDetectResult with matched intent label and confidence.
   */
  detect(input: string, language: string): IntentDetectResult {
    const lowerInput = input.toLowerCase();

    // Expand input with known synonyms from glossary (appended as a single text blob)
    const expandedText = this.expandWithGlossary(lowerInput);

    for (const template of this.templates) {
      const matched = template.keywords.some((kw) =>
        expandedText.includes(kw.toLowerCase()),
      );

      if (matched) {
        return {
          intentLabel: template.intent,
          confidence: 1,
          language,
        };
      }
    }

    return { intentLabel: null, confidence: 0, language };
  }

  /**
   * Determine whether the conversation exhibits high-purchase-intent signals.
   *
   * **Phase 1 skeleton** — always returns false.
   * Phase 4 (T4-005) will implement sliding-window keyword scoring using
   * `SystemConfig.high_intent_look_back_turns` and
   * `SystemConfig.high_intent_threshold`.
   *
   * @param _history - Recent conversation messages (user + assistant turns).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isHighIntent(_history: ConversationMessageLike[]): boolean {
    // TODO(Phase 4 / T4-005): Implement rule-based high-intent scoring.
    return false;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Expand input by appending any synonym aliases found in the glossary.
   * Returns a single concatenated lowercase string for substring matching.
   */
  private expandWithGlossary(lowerInput: string): string {
    let expanded = lowerInput;

    for (const term of this.glossary) {
      const allForms = [term.term, ...term.synonyms].map((f) =>
        f.toLowerCase(),
      );
      const matchesTerm = allForms.some((f) => lowerInput.includes(f));
      if (matchesTerm) {
        // Append all synonym forms so they are available for keyword matching
        expanded += ' ' + allForms.join(' ');
      }
    }

    return expanded;
  }
}
