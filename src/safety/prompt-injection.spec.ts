import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { SafetyService } from './safety.service.js';
import { SafetyRepository } from './safety.repository.js';
import type { SafetyRule, BlacklistEntry } from '../generated/prisma/client';
import {
  PROMPT_INJECTION_FIXTURES,
  INJECTION_RULES,
} from './__fixtures__/prompt-injection.fixtures.js';

/**
 * Prompt Injection & Jailbreak fixture-driven tests — T3-008.
 *
 * Attack patterns: ≥ 10 distinct patterns seeded via INJECTION_RULES.
 * Required interception rate: ≥ 95% of fixtures with expectedBlocked=true.
 */

function makeSafetyRule(
  id: number,
  override: { type: string; pattern: string; isRegex: boolean },
): SafetyRule {
  return {
    id,
    type: override.type,
    pattern: override.pattern,
    isRegex: override.isRegex,
    isActive: true,
    createdAt: new Date(),
  };
}

describe('Prompt Injection fixtures (T3-008)', () => {
  let service: SafetyService;
  let repo: jest.Mocked<SafetyRepository>;

  beforeEach(async () => {
    repo = {
      findAllRules: jest.fn<() => Promise<SafetyRule[]>>(),
      findAllBlacklist: jest.fn<() => Promise<BlacklistEntry[]>>(),
    } as unknown as jest.Mocked<SafetyRepository>;

    // Prime the cache with all fixture rules
    repo.findAllRules.mockResolvedValue(
      INJECTION_RULES.map((rule, idx) => makeSafetyRule(idx + 1, rule)),
    );
    repo.findAllBlacklist.mockResolvedValue([]);

    service = new SafetyService(repo);
    await service.loadCache();
  });

  // ─── it.each over full fixture set ────────────────────────────────────────

  it.each(PROMPT_INJECTION_FIXTURES)(
    '$label',
    async ({ input, expectedBlocked, expectedCategory }) => {
      const result = service.scanPrompt(input);
      expect(result.blocked).toBe(expectedBlocked);

      if (expectedBlocked) {
        expect(result.category).toBe(expectedCategory);
        // promptHash must always be a 64-char hex string
        expect(result.promptHash).toMatch(/^[0-9a-f]{64}$/);
      }
    },
  );

  // ─── Interception-rate assertion (≥ 95%) ─────────────────────────────────

  it('achieves ≥ 95% interception rate across all attack fixtures', () => {
    const attackFixtures = PROMPT_INJECTION_FIXTURES.filter((f) => f.expectedBlocked);
    const blockedCount = attackFixtures.filter(
      (f) => service.scanPrompt(f.input).blocked,
    ).length;

    const rate = blockedCount / attackFixtures.length;
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  // ─── invalidateCache reloads rules ───────────────────────────────────────

  it('reloads cache after invalidateCache() — new rule is applied immediately', async () => {
    // Before adding the new rule, this benign input should not be blocked
    const benign = 'normal product question about rubber seals';
    expect(service.scanPrompt(benign).blocked).toBe(false);

    // Add a rule that matches the previously-benign input
    const extended = [
      ...INJECTION_RULES.map((rule, idx) => makeSafetyRule(idx + 1, rule)),
      makeSafetyRule(99, {
        type: 'jailbreak',
        pattern: 'rubber seals',
        isRegex: false,
      }),
    ];
    repo.findAllRules.mockResolvedValue(extended);

    await service.invalidateCache();

    expect(service.scanPrompt(benign).blocked).toBe(true);
  });
});
