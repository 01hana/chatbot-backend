/**
 * prisma/seeds/seed.ts — main seed entry point
 *
 * Execution order:
 *   1. system-config    (always — needed for all phases)
 *   2. widget-config    (Phase 2: T2-014 — always, needed for Widget API)
 *   3. safety-rules     (Phase 1: T1-003)
 *   4. blacklist        (Phase 1: T1-003)
 *   5. intent-templates (Phase 1: T1-004)
 *   6. glossary-terms   (Phase 1: T1-004)
 *   7. knowledge        (Phase 1: T1-005 — skipped in production)
 *
 * Run with: npx prisma db seed
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { seedSafetyRules } from './safety-rules.seed';
import { seedBlacklist } from './blacklist.seed';
import { seedIntentTemplates } from './intent-templates.seed';
import { seedGlossaryTerms } from './glossary-terms.seed';
import { seedKnowledge } from './knowledge.seed';
import { seedKnowledgePublicZh } from './knowledge-public-zh.seed';
import { seedKnowledgePublicEn } from './knowledge-public-en.seed';
import { seedWidgetConfig } from './widget-config.seed';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

// ---------------------------------------------------------------------------
// SystemConfig initial values
// ---------------------------------------------------------------------------
const SYSTEM_CONFIG_DEFAULTS = [
  // Rate limiting
  { key: 'rate_limit_per_ip_per_min', value: '60', description: 'Max requests per IP per minute' },

  // RAG retrieval thresholds
  { key: 'rag_confidence_threshold', value: '0.6', description: 'Min pg_trgm similarity score to include a result' },
  { key: 'rag_minimum_score', value: '0.3', description: 'Absolute minimum score before ILIKE fallback is used' },
  { key: 'llm_max_context_tokens', value: '8000', description: 'Max tokens in the full prompt context window' },

  // LLM settings
  { key: 'llm_timeout_ms', value: '10000', description: 'LLM call hard timeout in milliseconds' },

  // AI status / degraded detection
  { key: 'ai_degraded_threshold', value: '3', description: 'Consecutive LLM failures before degraded mode activates' },

  // Safety
  { key: 'sensitive_intent_alert_threshold', value: '3', description: 'Accumulated sensitive intents before alert is logged' },

  // High-intent detection (Phase 4)
  { key: 'high_intent_threshold', value: '2', description: 'Min high-intent score before lead prompt is shown' },
  { key: 'high_intent_look_back_turns', value: '5', description: 'Number of recent turns examined for high-intent signals' },

  // Widget config (Phase 2)
  { key: 'widget_status', value: 'online', description: 'Widget operational status: online | offline | degraded' },

  // Fallback messages (Phase 2)
  { key: 'fallback_message_zh', value: '抱歉，目前服務暫時無法使用，請稍後再試或留下聯絡資訊，我們將儘速回覆。', description: 'Fallback reply when AI is degraded (zh-TW)' },
  { key: 'fallback_message_en', value: 'Sorry, the service is temporarily unavailable. Please try again later or leave your contact info and we\'ll get back to you.', description: 'Fallback reply when AI is degraded (en)' },

  // Webhook
  { key: 'webhook_timeout_ms', value: '5000', description: 'Webhook HTTP call timeout in milliseconds' },
] as const;

async function seedSystemConfig(): Promise<void> {
  console.log('Seeding SystemConfig...');
  for (const entry of SYSTEM_CONFIG_DEFAULTS) {
    await prisma.systemConfig.upsert({
      where: { key: entry.key },
      update: {}, // never overwrite values that an admin has already changed
      create: { key: entry.key, value: entry.value, description: entry.description },
    });
  }
  console.log(`SystemConfig: upserted ${SYSTEM_CONFIG_DEFAULTS.length} entries`);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  console.log(`Running seeds (NODE_ENV=${nodeEnv})...`);

  await seedSystemConfig();
  await seedWidgetConfig(prisma);
  await seedSafetyRules(prisma);
  await seedBlacklist(prisma);
  await seedIntentTemplates(prisma);
  await seedGlossaryTerms(prisma);

  if (nodeEnv !== 'production') {
    console.log('Seeding knowledge entries (non-production)...');
    await seedKnowledge(prisma);
  } else {
    console.log('Skipping knowledge.seed.ts (NODE_ENV=production)');
  }

  // Public knowledge entries (official website content) — run in all environments
  console.log('Seeding public knowledge entries (all environments)...');
  await seedKnowledgePublicZh(prisma);
  await seedKnowledgePublicEn(prisma);

  console.log('Seed complete.');
}

main()
  .catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
