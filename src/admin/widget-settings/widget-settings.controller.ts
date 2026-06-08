import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { UpdateWidgetSettingsDto } from './dto/update-widget-settings.dto';
import type { AdminWidgetSettingsVm } from './dto/update-widget-settings.dto';
import { AdminWidgetSettingsService } from './widget-settings.service';

/**
 * AdminWidgetSettingsController — routes for /api/v1/admin/widget-settings.
 *
 * Auth / RBAC is intentionally deferred for this phase.
 */
@Controller('admin/widget-settings')
export class AdminWidgetSettingsController {
  constructor(private readonly widgetSettingsService: AdminWidgetSettingsService) {}

  /** Return widget settings editable by the admin frontend. */
  @Get()
  getSettings(): AdminWidgetSettingsVm {
    return this.widgetSettingsService.getSettings();
  }

  /** Update widget status and copy settings. */
  @Patch()
  @HttpCode(HttpStatus.OK)
  updateSettings(@Body() dto: UpdateWidgetSettingsDto): Promise<AdminWidgetSettingsVm> {
    return this.widgetSettingsService.updateSettings(dto);
  }
}
