/**
 * seed.e2e-spec.ts — T1-012 Phase 1 Seed integration tests
 *
 * Tests the behaviour of `seedKnowledge()` and the NODE_ENV conditional gate
 * in seed.ts without requiring a real Postgres connection.
 *
 * Approach:
 *  - `seedKnowledge()` is tested directly with a mock PrismaClient to verify
 *    it creates the expected rows and correctly skips duplicates.
 *  - The NODE_ENV conditional logic from seed.ts is replicated in-test to
 *    verify the guard works correctly under both environments.
 */
import { describe, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import { seedKnowledge } from '../prisma/seeds/knowledge.seed';
import { seedSafetyRules } from '../prisma/seeds/safety-rules.seed';
import { seedBlacklist } from '../prisma/seeds/blacklist.seed';
import { seedIntentTemplates } from '../prisma/seeds/intent-templates.seed';
import { seedGlossaryTerms } from '../prisma/seeds/glossary-terms.seed';
import { PrismaClient } from '../src/generated/prisma/client';

// ---------------------------------------------------------------------------
// Mock Prisma helpers
// ---------------------------------------------------------------------------

function buildMockPrisma(findFirstResult: unknown = null): jest.Mocked<Pick<PrismaClient, 'knowledgeEntry'>> {
  const create = jest.fn<() => Promise<unknown>>().mockResolvedValue({});
  const findFirst = jest.fn<() => Promise<unknown>>().mockResolvedValue(findFirstResult);

  return {
    knowledgeEntry: {
      create,
      findFirst,
    },
  } as unknown as jest.Mocked<Pick<PrismaClient, 'knowledgeEntry'>>;
}

// ---------------------------------------------------------------------------
// Full-model mock — covers all Phase 1 seed targets
// ---------------------------------------------------------------------------

type FullMockPrisma = {
  safetyRule: { findFirst: jest.Mock; upsert: jest.Mock };
  blacklistEntry: { upsert: jest.Mock };
  intentTemplate: { upsert: jest.Mock };
  glossaryTerm: { upsert: jest.Mock };
  knowledgeEntry: { create: jest.Mock; findFirst: jest.Mock };
  systemConfig: { upsert: jest.Mock };
};

function buildFullMockPrisma(): FullMockPrisma {
  return {
    safetyRule: {
      findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      upsert: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
    blacklistEntry: {
      upsert: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
    intentTemplate: {
      upsert: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
    glossaryTerm: {
      upsert: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
    knowledgeEntry: {
      create: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
      findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
    },
    systemConfig: {
      upsert: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seedKnowledge()', () => {
  it('creates 5 knowledge entries when none already exist', async () => {
    const mock = buildMockPrisma(null); // findFirst returns null → no existing entry

    await seedKnowledge(mock as unknown as PrismaClient);

    expect((mock.knowledgeEntry.create as jest.Mock).mock.calls.length).toBe(5);
  });

  it('does not duplicate entries that already exist (findFirst returns a row)', async () => {
    const existingRow = {
      id: 1,
      title: 'O型環材質選用指南',
      content: '...',
      intentLabel: 'product-inquiry',
      tags: [],
      status: 'approved',
      visibility: 'public',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    // All findFirst calls return an existing row → nothing should be created
    const mock = buildMockPrisma(existingRow);

    await seedKnowledge(mock as unknown as PrismaClient);

    expect((mock.knowledgeEntry.create as jest.Mock).mock.calls.length).toBe(0);
  });

  it('seeds entries with status="approved" and visibility="public"', async () => {
    const mock = buildMockPrisma(null);

    await seedKnowledge(mock as unknown as PrismaClient);

    const createCalls = (mock.knowledgeEntry.create as jest.Mock).mock.calls as [{ data: Record<string, unknown> }][];
    for (const [callArgs] of createCalls) {
      expect(callArgs.data.status).toBe('approved');
      expect(callArgs.data.visibility).toBe('public');
    }
  });

  it('seeds entries each with a non-empty title and content', async () => {
    const mock = buildMockPrisma(null);

    await seedKnowledge(mock as unknown as PrismaClient);

    const createCalls = (mock.knowledgeEntry.create as jest.Mock).mock.calls as [{ data: Record<string, unknown> }][];
    for (const [callArgs] of createCalls) {
      expect(typeof callArgs.data.title).toBe('string');
      expect((callArgs.data.title as string).length).toBeGreaterThan(0);
      expect(typeof callArgs.data.content).toBe('string');
      expect((callArgs.data.content as string).length).toBeGreaterThan(0);
    }
  });

  it('seeds entries each with a non-empty intentLabel', async () => {
    const mock = buildMockPrisma(null);

    await seedKnowledge(mock as unknown as PrismaClient);

    const createCalls = (mock.knowledgeEntry.create as jest.Mock).mock.calls as [{ data: Record<string, unknown> }][];
    for (const [callArgs] of createCalls) {
      expect(typeof callArgs.data.intentLabel).toBe('string');
      expect((callArgs.data.intentLabel as string).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// NODE_ENV conditional gate (mirrors the logic in seed.ts main())
// ---------------------------------------------------------------------------

describe('NODE_ENV conditional gate for seedKnowledge()', () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  /**
   * Simulates the seeding orchestrator logic from seed.ts main():
   *   if (nodeEnv !== 'production') { await seedKnowledge(prisma); }
   *
   * Extracted to allow testing without importing the self-executing seed.ts.
   */
  async function runConditionalSeed(
    prisma: PrismaClient,
    nodeEnv: string,
  ): Promise<{ knowledgeSeeded: boolean }> {
    if (nodeEnv !== 'production') {
      await seedKnowledge(prisma);
      return { knowledgeSeeded: true };
    }
    return { knowledgeSeeded: false };
  }

  it('executes seedKnowledge when NODE_ENV=development', async () => {
    process.env.NODE_ENV = 'development';
    const mock = buildMockPrisma(null);

    const { knowledgeSeeded } = await runConditionalSeed(
      mock as unknown as PrismaClient,
      process.env.NODE_ENV,
    );

    expect(knowledgeSeeded).toBe(true);
    expect((mock.knowledgeEntry.create as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('executes seedKnowledge when NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    const mock = buildMockPrisma(null);

    const { knowledgeSeeded } = await runConditionalSeed(
      mock as unknown as PrismaClient,
      process.env.NODE_ENV,
    );

    expect(knowledgeSeeded).toBe(true);
  });

  it('SKIPS seedKnowledge when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    const mock = buildMockPrisma(null);

    const { knowledgeSeeded } = await runConditionalSeed(
      mock as unknown as PrismaClient,
      process.env.NODE_ENV,
    );

    expect(knowledgeSeeded).toBe(false);
    expect((mock.knowledgeEntry.create as jest.Mock).mock.calls.length).toBe(0);
  });

  it('returns knowledgeSeeded: false and calls create 0 times for production', async () => {
    const mock = buildMockPrisma(null);

    const { knowledgeSeeded } = await runConditionalSeed(
      mock as unknown as PrismaClient,
      'production',
    );

    expect(knowledgeSeeded).toBe(false);
    expect((mock.knowledgeEntry.create as jest.Mock).mock.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// seedSafetyRules()
// ---------------------------------------------------------------------------

describe('seedSafetyRules()', () => {
  it('upserts at least 5 safety-rule entries', async () => {
    const mock = buildFullMockPrisma();

    await seedSafetyRules(mock as unknown as PrismaClient);

    expect((mock.safetyRule.upsert as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('includes both prompt_injection and jailbreak types', async () => {
    const mock = buildFullMockPrisma();

    await seedSafetyRules(mock as unknown as PrismaClient);

    const calls = (mock.safetyRule.upsert as jest.Mock).mock.calls as [{ create: Record<string, unknown> }][];
    const types = calls.map(([args]) => args.create.type as string);

    expect(types).toContain('prompt_injection');
    expect(types).toContain('jailbreak');
  });

  it('seeds every entry with required fields: type, pattern, isRegex, isActive=true', async () => {
    const mock = buildFullMockPrisma();

    await seedSafetyRules(mock as unknown as PrismaClient);

    const calls = (mock.safetyRule.upsert as jest.Mock).mock.calls as [{ create: Record<string, unknown> }][];
    for (const [args] of calls) {
      const data = args.create;
      expect(typeof data.type).toBe('string');
      expect((data.type as string).length).toBeGreaterThan(0);
      expect(typeof data.pattern).toBe('string');
      expect((data.pattern as string).length).toBeGreaterThan(0);
      expect(typeof data.isRegex).toBe('boolean');
      expect(data.isActive).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// seedBlacklist()
// ---------------------------------------------------------------------------

describe('seedBlacklist()', () => {
  it('upserts at least 10 blacklist entries', async () => {
    const mock = buildFullMockPrisma();

    await seedBlacklist(mock as unknown as PrismaClient);

    expect((mock.blacklistEntry.upsert as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it('seeds every entry with a non-empty keyword and type', async () => {
    const mock = buildFullMockPrisma();

    await seedBlacklist(mock as unknown as PrismaClient);

    const calls = (mock.blacklistEntry.upsert as jest.Mock).mock.calls as [{ create: Record<string, unknown> }][];
    for (const [args] of calls) {
      const data = args.create;
      expect(typeof data.keyword).toBe('string');
      expect((data.keyword as string).length).toBeGreaterThan(0);
      expect(typeof data.type).toBe('string');
      expect((data.type as string).length).toBeGreaterThan(0);
    }
  });

  it('covers confidential, internal, and pricing_sensitive types', async () => {
    const mock = buildFullMockPrisma();

    await seedBlacklist(mock as unknown as PrismaClient);

    const calls = (mock.blacklistEntry.upsert as jest.Mock).mock.calls as [{ create: Record<string, unknown> }][];
    const types = new Set(calls.map(([args]) => args.create.type as string));

    expect(types).toContain('confidential');
    expect(types).toContain('internal');
    expect(types).toContain('pricing_sensitive');
  });
});

// ---------------------------------------------------------------------------
// seedIntentTemplates()
// ---------------------------------------------------------------------------

describe('seedIntentTemplates()', () => {
  it('upserts exactly 4 intent-template entries', async () => {
    const mock = buildFullMockPrisma();

    await seedIntentTemplates(mock as unknown as PrismaClient);

    expect((mock.intentTemplate.upsert as jest.Mock).mock.calls.length).toBe(4);
  });

  it('includes all 4 required intent slugs', async () => {
    const mock = buildFullMockPrisma();

    await seedIntentTemplates(mock as unknown as PrismaClient);

    const calls = (mock.intentTemplate.upsert as jest.Mock).mock.calls as [{ create: Record<string, unknown> }][];
    const intents = calls.map(([args]) => args.create.intent as string);

    expect(intents).toContain('product-inquiry');
    expect(intents).toContain('product-diagnosis');
    expect(intents).toContain('price-inquiry');
    expect(intents).toContain('general-faq');
  });

  it('seeds every entry with non-empty templateZh and templateEn', async () => {
    const mock = buildFullMockPrisma();

    await seedIntentTemplates(mock as unknown as PrismaClient);

    const calls = (mock.intentTemplate.upsert as jest.Mock).mock.calls as [{ create: Record<string, unknown> }][];
    for (const [args] of calls) {
      const data = args.create;
      expect(typeof data.templateZh).toBe('string');
      expect((data.templateZh as string).length).toBeGreaterThan(0);
      expect(typeof data.templateEn).toBe('string');
      expect((data.templateEn as string).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// seedGlossaryTerms()
// ---------------------------------------------------------------------------

describe('seedGlossaryTerms()', () => {
  it('upserts at least 10 glossary-term entries', async () => {
    const mock = buildFullMockPrisma();

    await seedGlossaryTerms(mock as unknown as PrismaClient);

    expect((mock.glossaryTerm.upsert as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it('seeds every entry with a non-empty term and a synonyms array', async () => {
    const mock = buildFullMockPrisma();

    await seedGlossaryTerms(mock as unknown as PrismaClient);

    const calls = (mock.glossaryTerm.upsert as jest.Mock).mock.calls as [{ create: Record<string, unknown> }][];
    for (const [args] of calls) {
      const data = args.create;
      expect(typeof data.term).toBe('string');
      expect((data.term as string).length).toBeGreaterThan(0);
      expect(Array.isArray(data.synonyms)).toBe(true);
    }
  });

  it('at least some entries carry an intentLabel', async () => {
    const mock = buildFullMockPrisma();

    await seedGlossaryTerms(mock as unknown as PrismaClient);

    const calls = (mock.glossaryTerm.upsert as jest.Mock).mock.calls as [{ create: Record<string, unknown> }][];
    const withLabel = calls.filter(([args]) => args.create.intentLabel != null);

    expect(withLabel.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 seed orchestration
// ---------------------------------------------------------------------------

describe('Phase 1 seed orchestration', () => {
  /**
   * Mirrors the execution order of prisma/seeds/seed.ts main(),
   * excluding seedSystemConfig (not exported).
   * Returns the list of tables seeded in call order so tests can assert
   * both presence and ordering.
   */
  async function runSeedOrchestration(
    prisma: PrismaClient,
    nodeEnv: string,
  ): Promise<{ seededTables: string[] }> {
    const seededTables: string[] = [];

    await seedSafetyRules(prisma);
    seededTables.push('safetyRule');

    await seedBlacklist(prisma);
    seededTables.push('blacklistEntry');

    await seedIntentTemplates(prisma);
    seededTables.push('intentTemplate');

    await seedGlossaryTerms(prisma);
    seededTables.push('glossaryTerm');

    if (nodeEnv !== 'production') {
      await seedKnowledge(prisma);
      seededTables.push('knowledgeEntry');
    }

    return { seededTables };
  }

  it('seeds all Phase 1 tables in the correct order (non-production)', async () => {
    const mock = buildFullMockPrisma();

    const { seededTables } = await runSeedOrchestration(
      mock as unknown as PrismaClient,
      'development',
    );

    expect(seededTables).toEqual([
      'safetyRule',
      'blacklistEntry',
      'intentTemplate',
      'glossaryTerm',
      'knowledgeEntry',
    ]);
  });

  it('skips knowledgeEntry but runs all other seeds when NODE_ENV=production', async () => {
    const mock = buildFullMockPrisma();

    const { seededTables } = await runSeedOrchestration(
      mock as unknown as PrismaClient,
      'production',
    );

    expect(seededTables).not.toContain('knowledgeEntry');
    expect(seededTables).toContain('safetyRule');
    expect(seededTables).toContain('blacklistEntry');
    expect(seededTables).toContain('intentTemplate');
    expect(seededTables).toContain('glossaryTerm');
  });

  it('every domain seed function is invoked during a full non-production run', async () => {
    const mock = buildFullMockPrisma();

    await runSeedOrchestration(mock as unknown as PrismaClient, 'development');

    expect((mock.safetyRule.upsert as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((mock.blacklistEntry.upsert as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((mock.intentTemplate.upsert as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((mock.glossaryTerm.upsert as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((mock.knowledgeEntry.create as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });
});
