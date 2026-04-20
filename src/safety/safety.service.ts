import { createHash } from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SafetyRule, BlacklistEntry } from '../generated/prisma/client';
import { SafetyRepository } from './safety.repository';
import {
  SafetyBlockCategory,
  SafetyScanResult,
  ConfidentialityResult,
} from './types/safety-scan-result.type';

/**
 * SafetyService — loads and caches safety rules on startup; exposes
 * prompt-scan and confidentiality-check methods consumed by the chat pipeline.
 *
 * Phase 3 (T3-001 ~ T3-005) implementation status:
 *  - `loadCache()` / `invalidateCache()`: fully functional.
 *  - `scanPrompt()`: full 5-category detection —
 *      1. `prompt_injection`  — SafetyRule regex / plain-text patterns
 *      2. `jailbreak`         — SafetyRule regex / plain-text patterns
 *      3. `blacklist_keyword` — BlacklistEntry (non-confidential / non-internal)
 *      4. `confidential_topic`— SafetyRule with type='confidential' or 'confidential_topic'
 *      5. `internal_topic`    — SafetyRule with type='internal' or 'internal_topic'
 *    Always returns a `promptHash` (SHA-256) even when not blocked.
 *    BlacklistEntry entries typed 'confidential' / 'internal' are intentionally
 *    excluded here so that the pipeline writes a distinct `confidential_refused`
 *    audit event (step 4) rather than `prompt_guard_blocked` (step 3).
 *  - `checkConfidentiality()`: matches BlacklistEntry type='confidential' or
 *    type='internal'; case-insensitive substring check.
 *  - `buildRefusalResponse()`: returns a fixed, pre-defined refusal string in
 *    zh-TW or en — never LLM-generated, never reveals the matched keyword.
 *  - `buildHandoffGuidance()`: appended to refusal when
 *    `sensitive_intent_alert_threshold` is reached; guides user to leave
 *    contact information without automatically blocking the user.
 *
 * Still deferred to Phase 3 second batch (T3-006 ~ T3-009):
 *  - Admin CRUD API for SafetyRule / BlacklistEntry (T3-006)
 *  - Extended test fixtures and E2E safety tests (T3-007 ~ T3-009)
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
   * Scan the input for safety violations across five categories.
   *
   * Detection order (first match wins):
   *  1. SafetyRule patterns  — covers `prompt_injection`, `jailbreak`, and any
   *     regex/plain-text rule stored in the DB (supports `confidential_topic` /
   *     `internal_topic` types if added to SafetyRule via the admin API).
   *  2. BlacklistEntry keywords — generic sensitive terms (type ≠ 'confidential'
   *     and type ≠ 'internal').  Confidential / internal BlacklistEntry entries
   *     are handled exclusively by `checkConfidentiality()` (step 4) so that
   *     the pipeline can write a distinct `confidential_refused` audit event.
   *
   * Always returns a `promptHash` (SHA-256 of the raw input) so that step 4
   * can include it in the `confidential_refused` audit even when step 3 did
   * not block the request.
   *
   * @param input - Raw user message.
   */
  scanPrompt(input: string): SafetyScanResult {
    const promptHash = createHash('sha256').update(input, 'utf8').digest('hex');
    const lowerInput = input.toLowerCase();

    // ── 1 & 2: Safety rules (prompt_injection, jailbreak, regex-based confidential/internal) ──
    for (const rule of this.rules) {
      let matched = false;
      try {
        matched = rule.isRegex
          ? new RegExp(rule.pattern, 'i').test(input)
          : lowerInput.includes(rule.pattern.toLowerCase());
      } catch {
        this.logger.warn(
          `SafetyService: invalid regex in SafetyRule id=${rule.id}: ${rule.pattern}`,
        );
        continue;
      }

      if (matched) {
        return {
          blocked: true,
          category: this.ruleTypeToCategory(rule.type),
          blockedReason: `Safety rule triggered (type: ${rule.type})`,
          promptHash,
        };
      }
    }

    // ── 3: BlacklistEntry — generic sensitive keywords ──
    // Skip confidential / internal entries — those are handled by checkConfidentiality().
    for (const entry of this.blacklist) {
      if (entry.type === 'confidential' || entry.type === 'internal') continue;
      if (lowerInput.includes(entry.keyword.toLowerCase())) {
        return {
          blocked: true,
          category: 'blacklist_keyword',
          blockedReason: `Keyword blocked (type: ${entry.type})`,
          promptHash,
        };
      }
    }

    return { blocked: false, promptHash };
  }

  /**
   * Map a SafetyRule.type string to the canonical SafetyBlockCategory.
   * Unknown / unmapped types fall back to `blacklist_keyword`.
   */
  private ruleTypeToCategory(type: string): SafetyBlockCategory {
    switch (type) {
      case 'prompt_injection':   return 'prompt_injection';
      case 'jailbreak':          return 'jailbreak';
      case 'confidential':
      case 'confidential_topic': return 'confidential_topic';
      case 'internal':
      case 'internal_topic':     return 'internal_topic';
      default:                   return 'blacklist_keyword';
    }
  }

  /**
   * Check whether the input mentions confidential or internal topics.
   *
   * Checks BlacklistEntry entries with type `'confidential'` or `'internal'`.
   * These are intentionally excluded from `scanPrompt()` so that the pipeline
   * can write a distinct `confidential_refused` audit event (vs the generic
   * `prompt_guard_blocked` event written when `scanPrompt()` blocks).
   *
   * @param input - Raw user message.
   */
  checkConfidentiality(input: string): ConfidentialityResult {
    const lowerInput = input.toLowerCase();

    const match = this.blacklist.find(
      (entry) =>
        (entry.type === 'confidential' || entry.type === 'internal') &&
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
   * The response is always pre-defined (never LLM-generated).
   */
  buildRefusalResponse(language: string): string {
    if (language === 'en') {
      return "I'm sorry, I'm unable to assist with that request. If you need further help, please contact our customer service team.";
    }
    return '很抱歉，我無法回答此類問題。如需進一步協助，請聯繫我們的客服團隊。';
  }

  /**
   * Return a handoff guidance message appended to the refusal when the
   * `sensitive_intent_alert_threshold` has been reached.
   *
   * This text encourages the user to leave contact information so a human
   * agent can follow up — it does NOT automatically block the user.
   */
  buildHandoffGuidance(language: string): string {
    if (language === 'en') {
      return 'If you need further assistance, please leave your contact information and our team will reach out to you shortly.';
    }
    return '若您需要進一步協助，歡迎留下聯絡資訊，我們的業務人員將儘速與您聯繫。';
  }
}
