import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SystemConfigService } from '../system-config/system-config.service';
import { AiStatusService } from '../health/ai-status.service';
import { WIDGET_CONFIG_KEYS, WIDGET_STATUS_VALUES } from './widget-config.constants';
import type {
  MultiLangString,
  MultiLangStringArray,
  WidgetConfig,
  WidgetStatus,
} from './widget-config.types';

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
    const dbStatus = this.getDbStatus();
    const status: WidgetStatus = this.aiStatusService.isDegraded() ? 'degraded' : dbStatus;

    return {
      status,
      welcomeMessage: this.parseRequiredStringRecord(WIDGET_CONFIG_KEYS.welcomeMessage),
      quickReplies: this.parseRequiredStringArrayRecord(WIDGET_CONFIG_KEYS.quickReplies),
      disclaimer: this.parseRequiredStringRecord(WIDGET_CONFIG_KEYS.disclaimer),
      fallbackMessage: this.parseRequiredStringRecord(WIDGET_CONFIG_KEYS.fallbackMessage),
    };
  }

  private getDbStatus(): WidgetStatus {
    const raw = this.systemConfigService.get(WIDGET_CONFIG_KEYS.status);
    if (WIDGET_STATUS_VALUES.includes(raw as WidgetStatus)) {
      return raw as WidgetStatus;
    }
    return 'online';
  }

  private parseRequiredStringRecord(key: string): MultiLangString {
    const parsed = this.parseRequiredJsonb(key);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.values(parsed as Record<string, unknown>).every(value => typeof value === 'string')
    ) {
      return parsed as MultiLangString;
    }

    throw new InternalServerErrorException(`Invalid widget config shape for '${key}'`);
  }

  private parseRequiredStringArrayRecord(key: string): MultiLangStringArray {
    const parsed = this.parseRequiredJsonb(key);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.values(parsed as Record<string, unknown>).every(
        value => Array.isArray(value) && value.every(item => typeof item === 'string'),
      )
    ) {
      return parsed as MultiLangStringArray;
    }

    throw new InternalServerErrorException(`Invalid widget config shape for '${key}'`);
  }

  private parseRequiredJsonb(key: string): unknown {
    const raw = this.systemConfigService.get(key);
    if (!raw) {
      throw new InternalServerErrorException(`Missing widget config '${key}'`);
    }

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new InternalServerErrorException(`Invalid widget config JSON for '${key}'`);
    }
  }
}
