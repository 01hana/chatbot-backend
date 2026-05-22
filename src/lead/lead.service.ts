import { ConflictException, Injectable } from '@nestjs/common';
import { Conversation, Lead, LeadStatus, Ticket } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadRepository } from './lead.repository';
import { TicketService } from '../ticket/ticket.service';

export interface CreateLeadResult {
  lead: Lead;
  ticket: Ticket;
}

/**
 * LeadService — business logic for Lead and Ticket creation.
 *
 * createLead()          — called from POST /lead (visitor fills form)
 * createTicketOnly()    — called from POST /handoff (no visitor contact info)
 */
@Injectable()
export class LeadService {
  constructor(
    private readonly leadRepository: LeadRepository,
    private readonly ticketService: TicketService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create a Lead (from visitor-submitted DTO) and a paired Ticket.
   *
   * Copies risk/intent fields from the Conversation automatically.
   * Throws ConflictException if a Lead already exists for this session.
   */
  async createLead(
    conversation: Conversation,
    dto: CreateLeadDto,
    triggerReason = 'lead_form',
  ): Promise<CreateLeadResult> {
    const existing = await this.leadRepository.findByConversationId(conversation.id);
    if (existing) {
      throw new ConflictException('A lead already exists for this session');
    }

    const lead = await this.leadRepository.create({
      conversation: { connect: { id: conversation.id } },
      name: dto.name,
      email: dto.email,
      company: dto.company ?? null,
      phone: dto.phone ?? null,
      message: dto.message ?? null,
      language: dto.language ?? conversation.language ?? null,
      type: conversation.type ?? 'general',
      riskLevel: conversation.riskLevel ?? null,
      confidentialityTriggered:
        conversation.type === 'confidential' || conversation.riskLevel === 'high',
      // TODO: derive promptInjectionDetected from AuditLog prompt_guard_blocked events
      promptInjectionDetected: false,
      sensitiveIntentCount: conversation.sensitiveIntentCount ?? 0,
      highIntentScore: conversation.highIntentScore ?? 0,
      notificationStatus: 'pending',
    });

    const ticket = await this.ticketService.createTicket({
      conversation: { connect: { id: conversation.id } },
      lead: { connect: { id: lead.id } },
      status: 'open',
      triggerReason,
      summary: null,
      priority: 'medium',
      notes: [],
    });

    void this.auditService.log({
      sessionId: conversation.sessionId,
      eventType: 'lead_created',
      eventData: {
        leadId: lead.id,
        ticketId: ticket.id,
        name: lead.name,
        email: lead.email,
        triggerReason,
      },
    }).catch(() => undefined);

    void this.auditService.log({
      sessionId: conversation.sessionId,
      eventType: 'ticket_created',
      eventData: {
        ticketId: ticket.id,
        leadId: lead.id,
        triggerReason,
        status: 'open',
      },
    }).catch(() => undefined);

    return { lead, ticket };
  }

  /**
   * Create a Ticket only (no Lead) — used by handoff when visitor contact info
   * is not available.
   */
  async createTicketOnly(
    conversation: Conversation,
    triggerReason: string,
    summary?: string,
  ): Promise<Ticket> {
    const ticket = await this.ticketService.createTicket({
      conversation: { connect: { id: conversation.id } },
      status: 'open',
      triggerReason,
      summary: summary ?? null,
      priority: 'medium',
      notes: [],
    });

    void this.auditService.log({
      sessionId: conversation.sessionId,
      eventType: 'ticket_created',
      eventData: {
        ticketId: ticket.id,
        triggerReason,
        status: 'open',
      },
    }).catch(() => undefined);

    return ticket;
  }

  /**
   * Find a Lead by its primary key.
   */
  async findById(id: number): Promise<Lead | null> {
    return this.leadRepository.findById(id);
  }

  /**
   * List Leads with optional status filter and pagination.
   */
  async list(params: {
    status?: LeadStatus;
    skip?: number;
    take?: number;
  }): Promise<Lead[]> {
    return this.leadRepository.list(params);
  }

  /**
   * Update Lead fields (admin use).
   */
  async updateLead(
    id: number,
    data: Partial<{
      name: string;
      email: string;
      company: string;
      phone: string;
      message: string;
      language: string;
      notes: string;
    }>,
  ): Promise<Lead> {
    return this.leadRepository.update(id, data);
  }

  /**
   * Update the admin workflow status of a Lead.
   */
  async updateLeadStatus(id: number, status: LeadStatus): Promise<Lead> {
    return this.leadRepository.updateStatus(id, status);
  }

  /**
   * Append a freetext note to the Lead's notes field.
   */
  async appendNote(id: number, note: string): Promise<Lead> {
    return this.leadRepository.appendNote(id, note);
  }
}
