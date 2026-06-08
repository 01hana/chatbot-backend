import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { IntentTemplate, GlossaryTerm } from '../generated/prisma/client';
import { IntentRepository } from './intent.repository';
import {
  IntentDetectResult,
  ConversationMessageLike,
  HighIntentResult,
} from './types/intent-detect-result.type';
import type { AnalyzedQuery } from '../query-analysis/types/analyzed-query.type';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * IntentService — loads intent templates and glossary on startup; exposes
 * `detect()` and `isHighIntent()` consumed by the chat pipeline.
 *
 * 002 status (IG-005 / IG-006):
 *  - `detect()` upgraded to a three-layer routing architecture.
 *    Layer 1: high-confidence intent hints from AnalyzedQuery (score > 0.7).
 *    Layer 2: keyword matching — uses analyzedQuery.expandedTerms when the
 *             query analysis pipeline is active (IG-006), falls back to the
 *             internal glossary-expansion helper for backward-compat.
 *    Layer 3: no match → { intentLabel: null, confidence: 0 }.
 *  - `isActive=false` templates are skipped in all matching paths.
 *  - `detect(input, language)` (two-argument form) remains fully backward-
 *    compatible with all 001 pipeline tests.
 */
@Injectable()
export class IntentService implements OnModuleInit {
  private readonly logger = new Logger(IntentService.name);

  /** In-memory copy of all intent templates (priority-ordered). */
  private templates: IntentTemplate[] = [];

  /** In-memory copy of all glossary terms. */
  private glossary: GlossaryTerm[] = [];

  constructor(
    private readonly intentRepository: IntentRepository,
    @Optional()
    private readonly systemConfigService?: SystemConfigService,
  ) {}

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
   * Detect the intent of the user input using a three-layer routing strategy.
   *
   * **Layer 1 — AnalyzedQuery intent hints** (002, IG-005):
   *   When `analyzedQuery` is provided and contains a hint with score > 0.7,
   *   that hint is returned immediately without keyword matching.
   *
   * **Layer 2 — Keyword matching** (Phase 1 + 002 upgrade):
   *   When `analyzedQuery` is provided, uses `analyzedQuery.expandedTerms`
   *   (already expanded by GlossaryExpansionProvider, IG-006) joined as a
   *   search string.  When `analyzedQuery` is omitted (backward-compat path),
   *   falls back to the internal `expandWithGlossary()` helper that reads
   *   directly from the in-memory glossary cache.
  *   Only explicitly disabled templates (`isActive === false`) are skipped.
  *   Legacy rows without `isActive` remain eligible. Matching templates are
  *   evaluated in priority-descending order; the first keyword match wins.
   *
   * **Layer 3 — No match**:
   *   Returns `{ intentLabel: null, confidence: 0 }`.
   *
   * @param input         - Raw user message.
   * @param language      - Detected language code (e.g. "zh-TW", "en").
   * @param analyzedQuery - Optional 002 query analysis output; enables Layer 1
   *                        routing and richer Layer 2 term expansion. When
   *                        omitted the method behaves exactly as in 001.
   * @returns IntentDetectResult with matched intent label and confidence.
   */
  detect(input: string, language: string, analyzedQuery?: AnalyzedQuery): IntentDetectResult {
    // ── Layer 1: high-confidence intent hint from query analysis ─────────────
    if (analyzedQuery && analyzedQuery.intentHints.length > 0) {
      const topHint = analyzedQuery.intentHints[0]; // caller must sort by score desc
      if (topHint.score > 0.7) {
        return { intentLabel: topHint.label, confidence: topHint.score, language };
      }
    }

    // ── Layer 2: keyword matching against active templates ────────────────────
    //
    // IG-006: when analyzedQuery.expandedTerms are available (produced by
    // GlossaryExpansionProvider), those pre-expanded terms are the canonical
    // expansion source — we no longer need to run the internal glossary lookup.
    // Backward-compat fallback: call expandWithGlossary() which reads from the
    // same in-memory glossary cache using equivalent matching logic.
    const lowerInput = input.toLowerCase();
    const expandedText: string =
      analyzedQuery && analyzedQuery.expandedTerms.length > 0
        ? lowerInput + ' ' + analyzedQuery.expandedTerms.join(' ').toLowerCase()
        : this.expandWithGlossary(lowerInput);

    for (const template of this.templates) {
      // Skip templates only when they are explicitly disabled.
      // Legacy rows without `isActive` stay eligible for matching.
      if (template.isActive === false) continue;

      const matched = template.keywords.some((kw) =>
        expandedText.includes(kw.toLowerCase()),
      );

      if (matched) {
        return {
          intentLabel: template.title,
          confidence: 1,
          language,
        };
      }
    }

    // ── Layer 3: no match ─────────────────────────────────────────────────────
    return { intentLabel: null, confidence: 0, language };
  }

  /**
   * Determine whether recent conversation turns show high purchase intent.
   *
   * Scoring rules:
   * - Inspect recent N user turns (`high_intent_look_back_turns`, default 5)
   * - Match high-intent keywords and add +1 per unique keyword per turn
   * - `score >= high_intent_threshold` (default 2) => isHighIntent=true
   */
  isHighIntent(history: ConversationMessageLike[]): HighIntentResult {
    const lookBackTurns = this.systemConfigService?.getNumber('high_intent_look_back_turns') ?? 5;
    const threshold = this.systemConfigService?.getNumber('high_intent_threshold') ?? 2;

    const userMessages = history
      .filter(message => message.role === 'user')
      .slice(-Math.max(1, lookBackTurns));

    const keywords = this.collectHighIntentKeywords();

    let score = 0;
    const matchedKeywords = new Set<string>();

    for (const message of userMessages) {
      const text = message.content.toLowerCase();
      const perTurnMatched = new Set<string>();

      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          perTurnMatched.add(keyword);
        }
      }

      score += perTurnMatched.size;
      for (const keyword of perTurnMatched) matchedKeywords.add(keyword);
    }

    return {
      isHighIntent: score >= Math.max(1, threshold),
      score,
      matchedKeywords: Array.from(matchedKeywords),
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Backward-compat glossary expansion for the two-argument `detect()` call.
   *
   * Appends all synonym forms of any matching glossary entry to the input
   * string, producing a single concatenated lowercase string for substring
   * keyword matching.
   *
   * When `detect()` is called with an `analyzedQuery`, this method is NOT
   * invoked — the pre-expanded `analyzedQuery.expandedTerms` (produced by
   * GlossaryExpansionProvider) are used instead, ensuring a single shared
   * expansion implementation path in production (IG-006).
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

  private collectHighIntentKeywords(): string[] {
    const intentSignals = ['price', 'quotation', 'quote', 'sales', 'contact', 'purchase', 'order'];

    const templateKeywords = this.templates
      .filter(template => {
        const intentText = `${template.title} ${template.label}`.toLowerCase();
        return intentSignals.some(signal => intentText.includes(signal));
      })
      .flatMap(template => template.keywords)
      .map(keyword => keyword.toLowerCase().trim())
      .filter(keyword => keyword.length > 0);

    const glossaryKeywords = this.glossary
      .filter(term => {
        const label = (term.intentLabel ?? '').toLowerCase();
        return intentSignals.some(signal => label.includes(signal));
      })
      .flatMap(term => [term.term, ...term.synonyms])
      .map(keyword => keyword.toLowerCase().trim())
      .filter(keyword => keyword.length > 0);

    // TODO(T4-005): replace fallback list with dedicated high-intent keyword config table.
    const fallbackKeywords = [
      '報價',
      '多少錢',
      '價格',
      '詢價',
      '下單',
      '採購',
      '業務',
      '聯絡',
      'price',
      'quotation',
      'quote',
      'order',
      'purchase',
      'sales',
      'contact',
    ];

    return Array.from(
      new Set([...templateKeywords, ...glossaryKeywords, ...fallbackKeywords]),
    );
  }
}
