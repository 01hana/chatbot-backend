/**
 * safety-rules.seed.ts — Phase 1 T1-003
 *
 * Seeds initial SafetyRule rows covering common prompt-injection and jailbreak
 * patterns.  All patterns are conservative defaults; the full production list
 * should be managed through the Admin API after go-live.
 */
import { PrismaClient } from '../../src/generated/prisma/client';

const SAFETY_RULES: {
  type: string;
  pattern: string;
  isRegex: boolean;
}[] = [
  // ── Prompt injection — instruction override attempts ──────────────────────
  {
    type: 'prompt_injection',
    pattern: 'ignore (all |previous |above |prior )(instructions?|prompt|rules?|context)',
    isRegex: true,
  },
  {
    type: 'prompt_injection',
    pattern: 'disregard (all |previous |above |prior )?(instructions?|prompt|rules?)',
    isRegex: true,
  },
  {
    type: 'prompt_injection',
    pattern: 'forget (everything|all) (above|before|prior|previous)',
    isRegex: true,
  },
  {
    type: 'prompt_injection',
    pattern: 'you are now (a |an )?(different|new|another|evil|unrestricted)',
    isRegex: true,
  },
  {
    type: 'prompt_injection',
    pattern: 'override (your )?(system prompt|instructions?|rules?|guidelines?)',
    isRegex: true,
  },

  // ── Jailbreak — persona / mode switch ────────────────────────────────────
  {
    type: 'jailbreak',
    pattern: 'pretend (you are|to be) (an? )?(ai without|uncensored|unrestricted|evil|DAN)',
    isRegex: true,
  },
  {
    type: 'jailbreak',
    pattern: 'do anything now',
    isRegex: false,
  },
  {
    type: 'jailbreak',
    pattern: 'developer mode',
    isRegex: false,
  },
  {
    type: 'jailbreak',
    pattern: 'jailbreak',
    isRegex: false,
  },
  {
    type: 'jailbreak',
    pattern: 'act as (if you have no|without any) (restrictions?|limits?|guidelines?)',
    isRegex: true,
  },
];

export async function seedSafetyRules(prisma: PrismaClient): Promise<void> {
  console.log('  Seeding SafetyRule...');
  let upserted = 0;

  for (const rule of SAFETY_RULES) {
    await prisma.safetyRule.upsert({
      where: { id: await getOrReserveId(prisma, rule.pattern) },
      update: { type: rule.type, isRegex: rule.isRegex, isActive: true },
      create: { type: rule.type, pattern: rule.pattern, isRegex: rule.isRegex, isActive: true },
    });
    upserted++;
  }

  console.log(`  SafetyRule: ${upserted} entries upserted`);
}

/** Helper — find existing id by pattern or return 0 so upsert falls into create path. */
async function getOrReserveId(prisma: PrismaClient, pattern: string): Promise<number> {
  const existing = await prisma.safetyRule.findFirst({ where: { pattern } });
  return existing?.id ?? 0;
}
