import type { WidgetStatus } from './widget-config.types';

export const WIDGET_STATUS_VALUES = [
  'online',
  'offline',
  'degraded',
] as const satisfies readonly WidgetStatus[];

export const WIDGET_CONFIG_KEYS = {
  status: 'widget_status',
  welcomeMessage: 'widget_welcome_message',
  quickReplies: 'widget_quick_replies',
  disclaimer: 'widget_disclaimer',
  fallbackMessage: 'widget_fallback_message',
} as const;
