import { Module } from '@nestjs/common';
import { TicketRepository } from './ticket.repository';
import { TicketService } from './ticket.service';

/**
 * TicketModule — provides TicketRepository and TicketService.
 *
 * Exported so:
 *  - LeadModule can inject TicketRepository into LeadService (ticket creation)
 *  - TicketsAdminModule can inject TicketService for the admin API
 *
 * PrismaModule is @Global, so PrismaService is available here automatically.
 */
@Module({
  providers: [TicketRepository, TicketService],
  exports: [TicketRepository, TicketService],
})
export class TicketModule {}
