import { Module } from '@nestjs/common';
import { TicketModule } from '../../ticket/ticket.module';
import { TicketsAdminController } from './tickets-admin.controller';
import { TicketsAdminService } from './tickets-admin.service';

/**
 * TicketsAdminModule — provides the admin Ticket API endpoints.
 *
 * Imports TicketModule to access TicketService (business logic).
 * PrismaModule and AuditModule are @Global — no explicit imports needed.
 */
@Module({
  imports: [TicketModule],
  controllers: [TicketsAdminController],
  providers: [TicketsAdminService],
})
export class TicketsAdminModule {}
