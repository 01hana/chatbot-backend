/**
 * prisma/seeds/003-feature-flags.seed.ts
 *
 * 003 feature flags — all default to `false` (opt-in rollout).
 *
 * IMPORTANT: upsert uses `update: {}` so that admin-configured values
 * in SystemConfig are NEVER overwritten by re-running the seed.
 *
 * Flag reference:
 *   feature.query_understanding_v2_enabled — enable QU V2 QueryUnderstandingService
 *   feature.zh_tokenizer                  — zh-TW tokenizer: "rule-based" | "jieba"
 *   feature.hybrid_retrieval_enabled      — enable HybridRetrievalService (keyword+vector+graph)
 *   feature.no_answer_gate_enabled        — enable No-answer Gate (blocks LLM when canAnswer=false)
 *   feature.traceable_answer_enabled      — include trace + sourceReferences in GeneratedAnswer
 */
import { PrismaClient } from '../../src/generated/prisma/client';

const FEATURE_FLAGS_003 = [
  {
    key: 'feature.query_understanding_v2_enabled',
    value: 'false',
    description: '003: Enable QU V2 QueryUnderstandingService; falls back to 002 QueryAnalysisService when false',
  },
  {
    key: 'feature.zh_tokenizer',
    value: 'rule-based',
    description: '003: zh-TW tokenizer selection: "rule-based" (default) | "jieba" (requires nodejieba)',
  },
  {
    key: 'feature.hybrid_retrieval_enabled',
    value: 'false',
    description: '003: Enable HybridRetrievalService (keyword+vector+graph fusion); uses legacy PostgresRetrievalService when false',
  },
  {
    key: 'feature.no_answer_gate_enabled',
    value: 'false',
    description: '003: Enable No-answer Gate — blocks LLM call when canAnswer=false; gate works on both hybrid and legacy paths',
  },
  {
    key: 'feature.traceable_answer_enabled',
    value: 'false',
    description: '003: Include trace timing and sourceReferences in GeneratedAnswer / AuditLog',
  },
] as const;

/**
 * Seed 003 feature flags into SystemConfig.
 * Safe to call in all environments; never overwrites existing values.
 */
export async function seed003FeatureFlags(prisma: PrismaClient): Promise<void> {
  console.log('Seeding 003 feature flags...');
  for (const flag of FEATURE_FLAGS_003) {
    await prisma.systemConfig.upsert({
      where: { key: flag.key },
      update: {}, // never overwrite admin-changed values
      create: { key: flag.key, value: flag.value, description: flag.description },
    });
  }
  console.log(`003 feature flags: upserted ${FEATURE_FLAGS_003.length} entries`);
}
