import { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Widget Config seed — T2-014
 *
 * Seeds all `widget_*` SystemConfig keys with their default multi-language
 * JSONB values. These are used by WidgetConfigService to serve
 * `GET /api/v1/widget/config`.
 *
 * All fields use JSONB structure: { "zh-TW": "...", "en": "..." }
 * Runs in BOTH production and development (always needed for the Widget API).
 */
export async function seedWidgetConfig(prisma: PrismaClient): Promise<void> {
  console.log('Seeding Widget Config...');

  const widgetDefaults = [
    {
      key: 'widget_status',
      value: 'online',
      description: 'Widget operational status: online | offline | degraded',
    },
    {
      key: 'widget_welcome_message',
      value: JSON.stringify({
        'zh-TW': '歡迎使用震南客服，請問有什麼可以幫您？',
        en: 'Welcome! How can I help you today?',
      }),
      description: 'Widget welcome message (multi-language JSONB)',
    },
    {
      key: 'widget_quick_replies',
      value: JSON.stringify({
        'zh-TW': ['查詢產品規格', '聯絡業務', '其他問題'],
        en: ['Product specs', 'Contact sales', 'Other'],
      }),
      description: 'Quick reply button labels (multi-language JSONB)',
    },
    {
      key: 'widget_disclaimer',
      value: JSON.stringify({
        'zh-TW': '本服務由 AI 提供，回覆僅供參考。',
        en: 'This service is AI-powered. Responses are for reference only.',
      }),
      description: 'Widget disclaimer text (multi-language JSONB)',
    },
    {
      key: 'widget_fallback_message',
      value: JSON.stringify({
        'zh-TW': '目前服務暫時無法使用，請稍後再試或留下聯絡資訊。',
        en: 'Service temporarily unavailable. Please try again later or leave your contact info.',
      }),
      description: 'Widget fallback message shown when service is degraded (multi-language JSONB)',
    },
  ] as const;

  for (const entry of widgetDefaults) {
    await prisma.systemConfig.upsert({
      where: { key: entry.key },
      update: {}, // never overwrite values already changed by admin
      create: { key: entry.key, value: entry.value, description: entry.description },
    });
  }

  console.log(`Widget Config: upserted ${widgetDefaults.length} entries`);
}
