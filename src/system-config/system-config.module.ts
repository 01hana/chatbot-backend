import { Global, Module } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';

/**
 * SystemConfigModule — provides the in-memory SystemConfig cache.
 *
 * Marked @Global so that SystemConfigService can be injected anywhere in the
 * application without re-importing this module.  PrismaModule is already
 * global, so PrismaService is available here automatically.
 */
@Global()
@Module({
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
