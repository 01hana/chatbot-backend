import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AiStatusService } from './ai-status.service';

/**
 * HealthModule — provides health-check endpoints and the AiStatusService.
 *
 * PrismaModule is global so PrismaService is available here without
 * re-importing.  AiStatusService is exported so that Phase 2's ChatModule
 * can inject it to flip the degraded flag.
 */
@Module({
  controllers: [HealthController],
  providers: [AiStatusService],
  exports: [AiStatusService],
})
export class HealthModule {}
