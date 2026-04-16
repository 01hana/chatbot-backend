import { Module } from '@nestjs/common';
import { WidgetConfigController } from './widget-config.controller';
import { WidgetConfigService } from './widget-config.service';
import { HealthModule } from '../health/health.module';

/**
 * WidgetConfigModule — serves the public Widget Config API.
 *
 * SystemConfigModule is @Global so SystemConfigService is injected automatically.
 * HealthModule is imported explicitly to access AiStatusService.
 */
@Module({
  imports: [HealthModule],
  controllers: [WidgetConfigController],
  providers: [WidgetConfigService],
})
export class WidgetConfigModule {}
