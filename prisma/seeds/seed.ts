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
import { seedQueryRules } from './query-rules.seed';

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

  // ── 002 IG-004: Ranking profiles ────────────────────────────────────────
  // Key naming MUST match SystemConfigRankProfileProvider: ranking.{profile}.{field}
  // These are default values only; upsert never overwrites admin-changed values.

  // Default ranking profile — baseline, mirrors RETRIEVAL_SCORING constants
  { key: 'ranking.default.trgm_title_boost',   value: '1.2',  description: 'Trigram title boost for default profile (mirrors RETRIEVAL_SCORING.TRGM_TITLE_BOOST)' },
  { key: 'ranking.default.trgm_alias_bonus',   value: '0.10', description: 'Trigram alias ILIKE bonus for default profile' },
  { key: 'ranking.default.trgm_tag_bonus',     value: '0.05', description: 'Trigram tag ILIKE bonus for default profile' },
  { key: 'ranking.default.trgm_min_threshold', value: '0.10', description: 'Minimum trgm similarity threshold for default profile' },
  { key: 'ranking.default.ilike_title_score',  value: '0.90', description: 'ILIKE title flat score for default profile' },
  { key: 'ranking.default.ilike_alias_score',  value: '0.85', description: 'ILIKE alias flat score for default profile' },
  { key: 'ranking.default.ilike_tag_score',    value: '0.70', description: 'ILIKE tag flat score for default profile' },
  { key: 'ranking.default.ilike_content_score', value: '0.50', description: 'ILIKE content flat score for default profile' },

  // FAQ ranking profile — boosted alias/ILIKE for FAQ phrasing variants
  { key: 'ranking.faq.trgm_title_boost',   value: '1.0',  description: 'Trigram title boost for FAQ profile' },
  { key: 'ranking.faq.trgm_alias_bonus',   value: '0.20', description: 'Trigram alias ILIKE bonus for FAQ profile (elevated for FAQ variants)' },
  { key: 'ranking.faq.trgm_tag_bonus',     value: '0.03', description: 'Trigram tag ILIKE bonus for FAQ profile (reduced; tags less relevant for FAQ)' },
  { key: 'ranking.faq.trgm_min_threshold', value: '0.08', description: 'Minimum trgm similarity threshold for FAQ profile (slightly lower to catch paraphrase)' },
  { key: 'ranking.faq.ilike_title_score',  value: '0.90', description: 'ILIKE title flat score for FAQ profile' },
  { key: 'ranking.faq.ilike_alias_score',  value: '0.90', description: 'ILIKE alias flat score for FAQ profile (elevated; aliases hold FAQ question variants)' },
  { key: 'ranking.faq.ilike_tag_score',    value: '0.60', description: 'ILIKE tag flat score for FAQ profile' },
  { key: 'ranking.faq.ilike_content_score', value: '0.50', description: 'ILIKE content flat score for FAQ profile' },

  // Diagnosis ranking profile — boosted tag/problem-keyword matching
  { key: 'ranking.diagnosis.trgm_title_boost',   value: '1.0',  description: 'Trigram title boost for diagnosis profile' },
  { key: 'ranking.diagnosis.trgm_alias_bonus',   value: '0.05', description: 'Trigram alias ILIKE bonus for diagnosis profile (reduced; aliases less key for diagnosis)' },
  { key: 'ranking.diagnosis.trgm_tag_bonus',     value: '0.15', description: 'Trigram tag ILIKE bonus for diagnosis profile (elevated; tags carry problem-category signals)' },
  { key: 'ranking.diagnosis.trgm_min_threshold', value: '0.10', description: 'Minimum trgm similarity threshold for diagnosis profile' },
  { key: 'ranking.diagnosis.ilike_title_score',  value: '0.90', description: 'ILIKE title flat score for diagnosis profile' },
  { key: 'ranking.diagnosis.ilike_alias_score',  value: '0.75', description: 'ILIKE alias flat score for diagnosis profile' },
  { key: 'ranking.diagnosis.ilike_tag_score',    value: '0.80', description: 'ILIKE tag flat score for diagnosis profile (elevated for problem-keyword tags)' },
  { key: 'ranking.diagnosis.ilike_content_score', value: '0.50', description: 'ILIKE content flat score for diagnosis profile' },

  // ── 002 IG-004: Feature flags ────────────────────────────────────────────
  { key: 'feature.query_analysis_enabled', value: 'false', description: 'Enable 002 query analysis pipeline (true | false); default false to preserve 001 behaviour' },
  { key: 'feature.profile_selection_mode', value: 'rule-based', description: 'Ranking profile selection mode: rule-based | ml' },
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
  await seedQueryRules(prisma);

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
