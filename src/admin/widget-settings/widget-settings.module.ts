import { Module } from '@nestjs/common';
import { AdminWidgetSettingsController } from './widget-settings.controller';
import { AdminWidgetSettingsService } from './widget-settings.service';

/** Admin widget settings endpoints. */
@Module({
  controllers: [AdminWidgetSettingsController],
  providers: [AdminWidgetSettingsService],
})
export class AdminWidgetSettingsModule {}
