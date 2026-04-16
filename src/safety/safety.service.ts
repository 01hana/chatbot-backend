import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SafetyRule, BlacklistEntry } from '../generated/prisma/client';
import { SafetyRepository } from './safety.repository';
import {
  SafetyScanResult,
  ConfidentialityResult,
} from './types/safety-scan-result.type';

/**
 * SafetyService — loads and caches safety rules on startup; exposes
 * prompt-scan and confidentiality-check methods consumed by the chat pipeline.
 *
 * Phase 1 status:
 *  - `loadCache()` and `invalidateCache()` are fully functional.
 *  - `scanPrompt()` is a skeleton — returns `blocked: false` for all input.
 *    Full pattern-matching logic will be implemented in Phase 3 (T3-001).
 *  - `checkConfidentiality()` is a skeleton — performs a naïve case-insensitive
 *    substring match against `confidential`-typed blacklist entries.
 *    Phase 3 will add proper tokenisation and SHA-256 hash audit trails.
 */
@Injectable()
export class SafetyService implements OnModuleInit {
  private readonly logger = new Logger(SafetyService.name);

  /** Active safety rules (prompt-injection / jailbreak patterns). */
  private rules: SafetyRule[] = [];

  /** Active blacklist entries (confidential / internal / pricing_sensitive). */
  private blacklist: BlacklistEntry[] = [];

  constructor(private readonly safetyRepository: SafetyRepository) {}

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.loadCache();
  }

  // ─── Cache Management ─────────────────────────────────────────────────────

  /**
   * Load (or reload) all active rules and blacklist entries from the database.
   *
   * Called automatically on startup and by `invalidateCache()` after any
   * admin mutation to safety-related tables.
   */
  async loadCache(): Promise<void> {
    const [rules, blacklist] = await Promise.all([
      this.safetyRepository.findAllRules(),
      this.safetyRepository.findAllBlacklist(),
    ]);

    this.rules = rules;
    this.blacklist = blacklist;

    this.logger.log(
      `SafetyService cache loaded: ${this.rules.length} rules, ${this.blacklist.length} blacklist entries`,
    );
  }

  /**
   * Force a full cache reload from the database.
   *
   * Must be called by admin rule-management endpoints after any
   * CREATE / UPDATE / DELETE operation on `safety_rules` or `blacklist_entries`.
   */
  async invalidateCache(): Promise<void> {
    this.logger.log('SafetyService cache invalidated — reloading from DB');
    await this.loadCache();
  }

  // ─── Rule Accessors (read-only snapshots for testing) ─────────────────────

  /** Returns the current in-memory rules snapshot. */
  getCachedRules(): Readonly<SafetyRule[]> {
    return this.rules;
  }

  /** Returns the current in-memory blacklist snapshot. */
  getCachedBlacklist(): Readonly<BlacklistEntry[]> {
    return this.blacklist;
  }

  // ─── Safety Checks ────────────────────────────────────────────────────────

  /**
   * Scan the input for prompt-injection, jailbreak, and blacklist patterns.
   *
   * **Phase 1 skeleton** — always returns `{ blocked: false }`.
   * Phase 3 (T3-001) will implement the full five-category detection logic:
   *   1. prompt_injection (regex SafetyRule)
   *   2. jailbreak (regex SafetyRule)
   *   3. blacklist_keyword (BlacklistEntry substring match)
   *   4. confidential_topic (type='confidential' entries)
   *   5. internal_topic (type='internal' entries)
   *
   * @param input - Raw user message.
   * @returns SafetyScanResult with `blocked: false` during Phase 1.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scanPrompt(_input: string): SafetyScanResult {
    // TODO(Phase 3 / T3-001): Implement full pattern matching.
    return { blocked: false };
  }

  /**
   * Check whether the input mentions confidential or internal topics.
   *
   * **Phase 1 skeleton** — performs a naïve case-insensitive substring check
   * against `type='confidential'` blacklist entries only.
   * Phase 3 (T3-002) will extend this to cover `type='internal'` entries,
   * add tokenisation, and compute SHA-256 audit hashes.
   *
   * @param input - Raw user message.
   * @returns ConfidentialityResult indicating whether a match was found.
   */
  checkConfidentiality(input: string): ConfidentialityResult {
    const lowerInput = input.toLowerCase();

    const match = this.blacklist.find(
      (entry) =>
        entry.type === 'confidential' &&
        lowerInput.includes(entry.keyword.toLowerCase()),
    );

    if (match) {
      return {
        triggered: true,
        matchedType: match.type,
        matchedKeyword: match.keyword,
      };
    }

    return { triggered: false };
  }

  /**
   * Return a fixed refusal response in the requested language.
   *
   * The text is deliberately vague — it must not reveal which rule was
   * triggered or what the confidential topic is.
   *
   * Phase 3 (T3-002) may enrich this with category-specific wording, but
   * the response will always be pre-defined (never LLM-generated).
   */
  buildRefusalResponse(language: string): string {
    if (language === 'en') {
      return 'I\'m sorry, I\'m unable to assist with that request. If you need further help, please contact our customer service team.';
    }
    return '很抱歉，我無法回答此類問題。如需進一步協助，請聯繫我們的客服團隊。';
  }
}
