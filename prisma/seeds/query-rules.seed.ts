import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * seedQueryRules — seeds the initial set of DB-managed query preprocessing rules.
 *
 * Rule types:
 *  stop_word         — words removed during question-shell normalisation
 *  noise_word        — tokens removed after tokenisation (lower signal than stop words)
 *  question_shell_zh — regex patterns for zh-TW leading/trailing question structures
 *  question_shell_en — regex patterns for en leading/trailing question structures
 *
 * All entries use upsert so the seed is idempotent.
 * Values here mirror the hardcoded fallbacks in RuleBasedQueryAnalyzer, ensuring
 * the DB-backed path produces identical behaviour to the hardcoded fallback path.
 */
export async function seedQueryRules(prisma: PrismaClient): Promise<void> {
  console.log('Seeding QueryRules...');

  const rules: Array<{
    type: string;
    language: string;
    value: string;
    priority: number;
  }> = [
    // ── zh-TW stop words (leading question starters) ──────────────────────
    { type: 'stop_word', language: 'zh-TW', value: '請問', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '請問一下', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '想問', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '想問一下', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '我想問', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '請幫我', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '幫我查', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '查一下', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '告訴我', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '想知道', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '麻煩你', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '請告訴我', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '我想了解', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '能告訴我', priority: 10 },
    { type: 'stop_word', language: 'zh-TW', value: '你好', priority: 5 },
    { type: 'stop_word', language: 'zh-TW', value: '謝謝', priority: 5 },

    // ── zh-TW noise words (low-signal filler tokens) ──────────────────────
    { type: 'noise_word', language: 'zh-TW', value: '一些', priority: 0 },
    { type: 'noise_word', language: 'zh-TW', value: '一下', priority: 0 },
    { type: 'noise_word', language: 'zh-TW', value: '一點', priority: 0 },
    { type: 'noise_word', language: 'zh-TW', value: '相關', priority: 0 },

    // ── en stop words (mirrors QueryNormalizer.EN_STOP_WORDS) ─────────────
    ...(
      [
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
        'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
        'should', 'may', 'might', 'i', 'we', 'you', 'it', 'its', 'my',
        'your', 'our', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'from',
        'with', 'and', 'or', 'not', 'that', 'this', 'these', 'those',
      ] as const
    ).map(w => ({ type: 'stop_word', language: 'en', value: w, priority: 0 })),

    // ── zh-TW question-shell patterns ─────────────────────────────────────
    // Mirrors RuleBasedQueryAnalyzer ZH_LEADING / ZH_QUESTION_VERBS / ZH_TRAILING_PARTICLES
    {
      type: 'question_shell_zh',
      language: 'zh-TW',
      value: '^(請問(?:一下)?|想問(?:一下)?|我想問|請幫我|幫我查|查一下|告訴我|想知道|麻煩你|請告訴我|我想了解|能告訴我)[，,\\s]*',
      priority: 30,
    },
    {
      type: 'question_shell_zh',
      language: 'zh-TW',
      value: '^(如何|怎麼|怎樣|可以|有沒有辦法|能否)',
      priority: 20,
    },
    {
      type: 'question_shell_zh',
      language: 'zh-TW',
      value: '\\s*(有哪些|有哪幾種|有什麼|是什麼|怎麼樣|可以嗎|嗎|呢|啊|喔|好嗎)[？?！!。.…]*$',
      priority: 20,
    },

    // ── en question-shell patterns ────────────────────────────────────────
    {
      type: 'question_shell_en',
      language: 'en',
      value:
        '^(how\\s+(?:can|do|could|would|should)\\s+(?:i|we|you|one)\\s+|how\\s+to\\s+|what\\s+(?:are\\s+the\\s+|is\\s+the\\s+|types\\s+of\\s+|kind\\s+of\\s+)?|what\\s+|where\\s+can\\s+(?:i|we)\\s+|where\\s+do\\s+(?:i|we)\\s+|can\\s+(?:i|we|you)\\s+|is\\s+there\\s+(?:a\\s+way\\s+to\\s+)?|do\\s+you\\s+(?:have\\s+|offer\\s+|provide\\s+)?|please\\s+(?:tell\\s+me\\s+(?:about\\s+)?)?|could\\s+you\\s+(?:tell\\s+me\\s+(?:about\\s+)?)?)',
      priority: 20,
    },
    {
      type: 'question_shell_en',
      language: 'en',
      value: '\\s*(do\\s+you\\s+(?:have|offer|provide|carry)|can\\s+you\\s+(?:tell\\s+me)?)[?!.]*$',
      priority: 10,
    },
  ];

  let created = 0;
  for (const rule of rules) {
    const existing = await prisma.queryRule.findFirst({
      where: { type: rule.type, language: rule.language, value: rule.value },
    });
    if (!existing) {
      await prisma.queryRule.create({ data: { ...rule, isActive: true } });
      created++;
    }
  }

  console.log(`QueryRules: ${created} new rules inserted (${rules.length - created} already existed)`);
}
