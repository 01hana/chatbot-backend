import { Module } from '@nestjs/common';
import { LeadRepository } from './lead.repository';
import { LeadService } from './lead.service';
import { TicketModule } from '../ticket/ticket.module';

/**
 * LeadModule — provides LeadService and LeadRepository.
 *
 * Imports TicketModule so that LeadService can create Tickets via
 * TicketService during Lead creation.
 *
 * PrismaModule and AuditModule are @Global, so they are available here
 * without an explicit import.
 */
@Module({
  imports: [TicketModule],
  providers: [LeadService, LeadRepository],
  exports: [LeadService],
})
export class LeadModule {}
