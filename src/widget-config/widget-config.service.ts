import { Injectable } from '@nestjs/common';
import { SystemConfigService } from '../system-config/system-config.service';
import { AiStatusService } from '../health/ai-status.service';

/**
 * Multi-language string map: { "zh-TW": "...", "en": "..." }
 */
export type MultiLangString = Record<string, string>;

/**
 * Multi-language string-array map: { "zh-TW": [...], "en": [...] }
 */
export type MultiLangStringArray = Record<string, string[]>;

export type WidgetStatus = 'online' | 'offline' | 'degraded';

/** Full response shape for GET /api/v1/widget/config */
export interface WidgetConfig {
  status: WidgetStatus;
  welcomeMessage: MultiLangString;
  quickReplies: MultiLangStringArray;
  disclaimer: MultiLangString;
  fallbackMessage: MultiLangString;
}

/**
 * WidgetConfigService — assembles the Widget Config API response from
 * SystemConfig values.
 *
 * - All `widget_*` keys are stored as JSONB strings in SystemConfig.
 * - When AI is degraded (`AiStatusService.isDegraded()`), the `status` field
 *   is automatically overridden to `"degraded"` regardless of the DB value.
 */
@Injectable()
export class WidgetConfigService {
  private readonly FALLBACK_WELCOME: MultiLangString = {
    'zh-TW': '歡迎使用震南客服，請問有什麼可以幫您？',
    en: 'Welcome! How can I help you today?',
  };

  private readonly FALLBACK_QUICK_REPLIES: MultiLangStringArray = {
    'zh-TW': ['查詢產品規格', '聯絡業務', '其他問題'],
    en: ['Product specs', 'Contact sales', 'Other'],
  };

  private readonly FALLBACK_DISCLAIMER: MultiLangString = {
    'zh-TW': '本服務由 AI 提供，回覆僅供參考。',
    en: 'This service is AI-powered. Responses are for reference only.',
  };

  private readonly FALLBACK_FALLBACK_MSG: MultiLangString = {
    'zh-TW': '目前服務暫時無法使用，請稍後再試或留下聯絡資訊。',
    en: 'Service temporarily unavailable. Please try again later or leave your contact info.',
  };

  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly aiStatusService: AiStatusService,
  ) {}

  /**
   * Build and return the Widget Config response.
   * Called on every request — reflects current DB values immediately.
   */
  getConfig(): WidgetConfig {
    // Determine status: degrade overrides DB value
    const dbStatus = (this.systemConfigService.get('widget_status') ?? 'online') as WidgetStatus;
    const status: WidgetStatus = this.aiStatusService.isDegraded() ? 'degraded' : dbStatus;

    return {
      status,
      welcomeMessage: this.parseJsonb<MultiLangString>('widget_welcome_message', this.FALLBACK_WELCOME),
      quickReplies: this.parseJsonb<MultiLangStringArray>('widget_quick_replies', this.FALLBACK_QUICK_REPLIES),
      disclaimer: this.parseJsonb<MultiLangString>('widget_disclaimer', this.FALLBACK_DISCLAIMER),
      fallbackMessage: this.parseJsonb<MultiLangString>('widget_fallback_message', this.FALLBACK_FALLBACK_MSG),
    };
  }

  /**
   * Parse a JSONB string from SystemConfig.
   * Falls back to `defaultValue` when the key is absent or the JSON is invalid.
   */
  private parseJsonb<T>(key: string, defaultValue: T): T {
    const raw = this.systemConfigService.get(key);
    if (!raw) return defaultValue;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }
}
