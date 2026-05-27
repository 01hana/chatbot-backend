import { Module } from '@nestjs/common';
import { LeadsAdminController } from './leads-admin.controller';
import { LeadsAdminService } from './leads-admin.service';

/**
 * LeadsAdminModule — provides the admin Lead API endpoints.
 *
 * PrismaModule and AuditModule are @Global — no explicit imports needed.
 */
@Module({
  controllers: [LeadsAdminController],
  providers: [LeadsAdminService],
})
export class LeadsAdminModule {}
