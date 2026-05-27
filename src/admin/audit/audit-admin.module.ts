import { Module } from '@nestjs/common';
import { AuditAdminController } from './audit-admin.controller';
import { AuditAdminService } from './audit-admin.service';

/**
 * AuditAdminModule — admin read API for the audit_logs table.
 *
 * PrismaModule is @Global so PrismaService is available without an explicit
 * import. AuditService (writer) is NOT injected here — reads only.
 */
@Module({
  controllers: [AuditAdminController],
  providers: [AuditAdminService],
})
export class AuditAdminModule {}
