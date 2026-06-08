import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import {
  WIDGET_CONFIG_KEYS,
  WIDGET_STATUS_VALUES,
} from '../../widget-config/widget-config.constants';
import type { WidgetStatus } from '../../widget-config/widget-config.types';
import { AdminWidgetSettingsVm, UpdateWidgetSettingsDto } from './dto/update-widget-settings.dto';

const WIDGET_SETTING_DESCRIPTIONS: Record<string, string> = {
  [WIDGET_CONFIG_KEYS.status]: 'Widget operational status: online | offline | degraded',
  [WIDGET_CONFIG_KEYS.welcomeMessage]: 'Widget welcome message (multi-language JSONB)',
  [WIDGET_CONFIG_KEYS.quickReplies]: 'Widget quick reply button labels (multi-language JSONB)',
  [WIDGET_CONFIG_KEYS.disclaimer]: 'Widget disclaimer text (multi-language JSONB)',
  [WIDGET_CONFIG_KEYS.fallbackMessage]:
    'Widget fallback message shown when service is degraded (multi-language JSONB)',
};

/**
 * AdminWidgetSettingsService — admin-facing settings for widget status and copy.
 */
@Injectable()
export class AdminWidgetSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigService,
    private readonly auditService: AuditService,
  ) {}

  /** Return admin editable widget settings without public degraded override. */
  getSettings(): AdminWidgetSettingsVm {
    return {
      status: this.getStatus(),
      welcomeMessage: this.parseStringRecordOrEmpty(WIDGET_CONFIG_KEYS.welcomeMessage),
      quickReplies: this.parseStringArrayRecordOrEmpty(WIDGET_CONFIG_KEYS.quickReplies),
      disclaimer: this.parseStringRecordOrEmpty(WIDGET_CONFIG_KEYS.disclaimer),
      fallbackMessage: this.parseStringRecordOrEmpty(WIDGET_CONFIG_KEYS.fallbackMessage),
    };
  }

  /** Replace supplied setting fields and return the fresh admin settings VM. */
  async updateSettings(dto: UpdateWidgetSettingsDto): Promise<AdminWidgetSettingsVm> {
    const updates: Array<{ key: string; value: string }> = [];
    if (dto.status !== undefined) {
      updates.push({ key: WIDGET_CONFIG_KEYS.status, value: dto.status });
    }
    if (dto.welcomeMessage !== undefined) {
      updates.push({
        key: WIDGET_CONFIG_KEYS.welcomeMessage,
        value: JSON.stringify(dto.welcomeMessage),
      });
    }
    if (dto.quickReplies !== undefined) {
      updates.push({
        key: WIDGET_CONFIG_KEYS.quickReplies,
        value: JSON.stringify(dto.quickReplies),
      });
    }
    if (dto.disclaimer !== undefined) {
      updates.push({
        key: WIDGET_CONFIG_KEYS.disclaimer,
        value: JSON.stringify(dto.disclaimer),
      });
    }
    if (dto.fallbackMessage !== undefined) {
      updates.push({
        key: WIDGET_CONFIG_KEYS.fallbackMessage,
        value: JSON.stringify(dto.fallbackMessage),
      });
    }

    if (updates.length === 0) {
      return this.getSettings();
    }

    const before = Object.fromEntries(
      updates.map(({ key }) => [key, this.systemConfig.get(key) ?? null]),
    );

    await Promise.all(
      updates.map(({ key, value }) =>
        this.prisma.systemConfig.upsert({
          where: { key },
          update: { value },
          create: {
            key,
            value,
            description: WIDGET_SETTING_DESCRIPTIONS[key],
          },
        }),
      ),
    );

    await this.systemConfig.invalidateCache();

    const after = Object.fromEntries(
      updates.map(({ key }) => [key, this.systemConfig.get(key) ?? null]),
    );

    void this.auditService
      .log({
        eventType: 'widget_settings_updated',
        eventData: {
          keys: updates.map(({ key }) => key),
          before,
          after,
        },
      })
      .catch(() => undefined);

    return this.getSettings();
  }

  private getStatus(): WidgetStatus {
    const raw = this.systemConfig.get(WIDGET_CONFIG_KEYS.status);
    if (WIDGET_STATUS_VALUES.includes(raw as WidgetStatus)) {
      return raw as WidgetStatus;
    }
    return 'online';
  }

  private parseStringRecordOrEmpty(key: string): Record<string, string> {
    const raw = this.systemConfig.get(key);
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.values(parsed as Record<string, unknown>).every(value => typeof value === 'string')
      ) {
        return parsed as Record<string, string>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private parseStringArrayRecordOrEmpty(key: string): Record<string, string[]> {
    const raw = this.systemConfig.get(key);
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.values(parsed as Record<string, unknown>).every(
          value => Array.isArray(value) && value.every(item => typeof item === 'string'),
        )
      ) {
        return parsed as Record<string, string[]>;
      }
      return {};
    } catch {
      return {};
    }
  }
}
