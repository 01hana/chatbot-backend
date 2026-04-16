import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * AuditModule — provides the append-only AuditService.
 *
 * Marked @Global so any module (chat pipeline, safety, lead, etc.) can inject
 * AuditService without importing AuditModule explicitly.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
