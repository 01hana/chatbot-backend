import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { SafetyService } from './safety.service.js';
import { SafetyRepository } from './safety.repository.js';
import type { SafetyRule, BlacklistEntry } from '../generated/prisma/client';
import {
  CONFIDENTIAL_SAMPLE_FIXTURES,
  CONFIDENTIAL_BLACKLIST,
} from './__fixtures__/confidential-samples.fixtures.js';

/**
 * Confidential & Internal topic fixture-driven tests — T3-009.
 *
 * Acceptance criteria:
 *  - 100% of `expectedTriggered=true` samples are caught by checkConfidentiality()
 *  - Refusal text does NOT contain any blacklisted keyword
 *  - `matchedType` and `matchedKeyword` are correctly populated
 */

function makeBlacklistEntry(
  id: number,
  override: { keyword: string; type: string },
): BlacklistEntry {
  return {
    id,
    keyword: override.keyword,
    type: override.type,
    isActive: true,
    createdAt: new Date(),
  };
}

describe('Confidential samples (T3-009)', () => {
  let service: SafetyService;
  let repo: jest.Mocked<SafetyRepository>;

  beforeEach(async () => {
    repo = {
      findAllRules: jest.fn<() => Promise<SafetyRule[]>>(),
      findAllBlacklist: jest.fn<() => Promise<BlacklistEntry[]>>(),
    } as unknown as jest.Mocked<SafetyRepository>;

    repo.findAllRules.mockResolvedValue([]);
    repo.findAllBlacklist.mockResolvedValue(
      CONFIDENTIAL_BLACKLIST.map((entry, idx) => makeBlacklistEntry(idx + 1, entry)),
    );

    service = new SafetyService(repo);
    await service.loadCache();
  });

  // ─── it.each over full fixture set ────────────────────────────────────────

  it.each(CONFIDENTIAL_SAMPLE_FIXTURES)(
    '$label',
    async ({ input, expectedTriggered, expectedType, matchedKeyword }) => {
      const result = service.checkConfidentiality(input);
      expect(result.triggered).toBe(expectedTriggered);

      if (expectedTriggered) {
        expect(result.matchedType).toBe(expectedType);
        expect(result.matchedKeyword).toBe(matchedKeyword);
      } else {
        expect(result.matchedType).toBeUndefined();
        expect(result.matchedKeyword).toBeUndefined();
      }
    },
  );

  // ─── 100% interception rate ────────────────────────────────────────────

  it('achieves 100% interception rate across all confidential sample fixtures', () => {
    const attackFixtures = CONFIDENTIAL_SAMPLE_FIXTURES.filter((f) => f.expectedTriggered);
    const triggeredCount = attackFixtures.filter(
      (f) => service.checkConfidentiality(f.input).triggered,
    ).length;

    expect(triggeredCount).toBe(attackFixtures.length);
  });

  // ─── Refusal text must not contain blacklisted keywords ───────────────────

  it('buildRefusalResponse(zh-TW) does not leak any blacklisted keywords', () => {
    const refusal = service.buildRefusalResponse('zh-TW');
    for (const entry of CONFIDENTIAL_BLACKLIST) {
      expect(refusal.toLowerCase()).not.toContain(entry.keyword.toLowerCase());
    }
  });

  it('buildRefusalResponse(en) does not leak any blacklisted keywords', () => {
    const refusal = service.buildRefusalResponse('en');
    for (const entry of CONFIDENTIAL_BLACKLIST) {
      expect(refusal.toLowerCase()).not.toContain(entry.keyword.toLowerCase());
    }
  });

  // ─── Case-insensitive matching for English keywords ───────────────────────

  it('triggers for lowercase NDA variant', () => {
    const result = service.checkConfidentiality('what is covered in the nda?');
    expect(result.triggered).toBe(true);
    expect(result.matchedKeyword).toBe('NDA');
  });

  it('triggers for mixed-case 員工名單 embedded in longer text', () => {
    const result = service.checkConfidentiality('我想了解一下公司的員工名單有多少人');
    expect(result.triggered).toBe(true);
    expect(result.matchedType).toBe('internal');
  });
});
