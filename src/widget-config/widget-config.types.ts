/** Multi-language string map: { "zh-TW": "...", "en": "..." } */
export type MultiLangString = Record<string, string>;

/** Multi-language string-array map: { "zh-TW": [...], "en": [...] } */
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
