import { Controller, Get, Header } from '@nestjs/common';
import { WidgetConfigService } from './widget-config.service';

/**
 * WidgetConfigController — serves the public Widget Config API.
 *
 * GET /api/v1/widget/config
 *
 * This is a public endpoint — no authentication required.
 * Returns current widget settings including multi-language text fields and
 * the live `status` (automatically "degraded" when AI is unavailable).
 *
 * Cache-Control: no-store is set so that every frontend request gets the
 * current live status (important when the AI flips to degraded).
 */
@Controller('widget')
export class WidgetConfigController {
  constructor(private readonly widgetConfigService: WidgetConfigService) {}

  /**
   * GET /api/v1/widget/config
   *
   * Response shape:
   * {
   *   "status": "online" | "offline" | "degraded",
   *   "welcomeMessage": { "zh-TW": "...", "en": "..." },
   *   "quickReplies":   { "zh-TW": ["..."], "en": ["..."] },
   *   "disclaimer":     { "zh-TW": "...", "en": "..." },
   *   "fallbackMessage":{ "zh-TW": "...", "en": "..." }
   * }
   */
  @Get('config')
  @Header('Cache-Control', 'no-store')
  getConfig() {
    return this.widgetConfigService.getConfig();
  }
}
