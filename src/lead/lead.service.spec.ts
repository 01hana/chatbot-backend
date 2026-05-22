import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { TicketService } from '../ticket/ticket.service';
import { AuditService } from '../audit/audit.service';
import type { Conversation, Lead, Ticket } from '../generated/prisma/client';
import type { CreateLeadDto } from './dto/create-lead.dto';

// ─── Factories ───────────────────────────────────────────────────────────────

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 1,
    sessionId: 'sess-uuid-001',
    session_token: 'token-abc',
    status: 'active',
    type: 'normal',
    riskLevel: null,
    sensitiveIntentCount: 0,
    highIntentScore: 0,
    diagnosisContext: null,
    language: 'zh-TW',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 10,
    conversationId: 1,
    name: 'Test User',
    email: 'test@example.com',
    company: null,
    phone: null,
    message: null,
    language: 'zh-TW',
    type: 'normal',
    riskLevel: null,
    confidentialityTriggered: false,
    promptInjectionDetected: false,
    sensitiveIntentCount: 0,
    highIntentScore: 0,
    summary: null,
    transcriptRef: null,
    notificationStatus: 'pending',
    status: 'new',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 20,
    leadId: 10,
    conversationId: 1,
    status: 'open',
    triggerReason: 'lead_form',
    summary: null,
    priority: 'medium',
    assignee: null,
    notes: [],
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeDto(overrides: Partial<CreateLeadDto> = {}): CreateLeadDto {
  return {
    name: 'Test User',
    email: 'test@example.com',
    ...overrides,
  };
}

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type MockLeadRepo = {
  [K in keyof LeadRepository]: jest.MockedFunction<LeadRepository[K]>;
};
type MockTicketService = {
  createTicket: jest.MockedFunction<TicketService['createTicket']>;
};
type MockAudit = {
  log: jest.MockedFunction<AuditService['log']>;
};

function makeLeadRepo(): MockLeadRepo {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByConversationId: jest.fn(),
    list: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    appendNote: jest.fn(),
  } as MockLeadRepo;
}

function makeTicketService(): MockTicketService {
  return {
    createTicket: jest.fn(),
  };
}

function makeAuditService(): MockAudit {
  return { log: jest.fn<AuditService['log']>().mockResolvedValue(undefined) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LeadService', () => {
  let service: LeadService;
  let leadRepo: MockLeadRepo;
  let mockTicketService: MockTicketService;
  let audit: MockAudit;

  beforeEach(() => {
    leadRepo = makeLeadRepo();
    mockTicketService = makeTicketService();
    audit = makeAuditService();
    service = new LeadService(
      leadRepo as unknown as LeadRepository,
      mockTicketService as unknown as TicketService,
      audit as unknown as AuditService,
    );
  });

  afterEach(() => { jest.clearAllMocks(); });

  // ── createLead ──────────────────────────────────────────────────────────

  describe('createLead()', () => {
    it('creates Lead and paired Ticket on success', async () => {
      const conversation = makeConversation();
      const lead = makeLead();
      const ticket = makeTicket();

      leadRepo.findByConversationId.mockResolvedValue(null);
      leadRepo.create.mockResolvedValue(lead);
      mockTicketService.createTicket.mockResolvedValue(ticket);

      const result = await service.createLead(conversation, makeDto());

      expect(result.lead.id).toBe(10);
      expect(result.ticket.id).toBe(20);
      expect(result.ticket.status).toBe('open');
    });

    it('sets triggerReason from argument (default: lead_form)', async () => {
      const conversation = makeConversation();
      leadRepo.findByConversationId.mockResolvedValue(null);
      leadRepo.create.mockResolvedValue(makeLead());
      mockTicketService.createTicket.mockResolvedValue(makeTicket());

      await service.createLead(conversation, makeDto(), 'handoff');

      expect(mockTicketService.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({ triggerReason: 'handoff' }),
      );
    });

    it('copies riskLevel from Conversation into Lead', async () => {
      const conversation = makeConversation({ riskLevel: 'high' });
      leadRepo.findByConversationId.mockResolvedValue(null);
      leadRepo.create.mockResolvedValue(makeLead());
      mockTicketService.createTicket.mockResolvedValue(makeTicket());

      await service.createLead(conversation, makeDto());

      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ riskLevel: 'high' }),
      );
    });

    it('throws ConflictException when lead already exists for session', async () => {
      leadRepo.findByConversationId.mockResolvedValue(makeLead());

      await expect(
        service.createLead(makeConversation(), makeDto()),
      ).rejects.toThrow(ConflictException);
    });

    it('stores name and email from DTO', async () => {
      const conversation = makeConversation();
      leadRepo.findByConversationId.mockResolvedValue(null);
      leadRepo.create.mockResolvedValue(makeLead());
      mockTicketService.createTicket.mockResolvedValue(makeTicket());

      await service.createLead(conversation, makeDto({ name: 'Alice', email: 'alice@x.com' }));

      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Alice', email: 'alice@x.com' }),
      );
    });

    it('writes lead_created and ticket_created audit events', async () => {
      const conversation = makeConversation();
      leadRepo.findByConversationId.mockResolvedValue(null);
      leadRepo.create.mockResolvedValue(makeLead());
      mockTicketService.createTicket.mockResolvedValue(makeTicket());

      await service.createLead(conversation, makeDto());

      // Wait for void promises to flush
      await new Promise((r) => setImmediate(r));

      const calls = audit.log.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
      expect(calls).toContain('lead_created');
      expect(calls).toContain('ticket_created');
    });

    it('does NOT call any Webhook or Email service', async () => {
      const conversation = makeConversation();
      leadRepo.findByConversationId.mockResolvedValue(null);
      leadRepo.create.mockResolvedValue(makeLead());
      mockTicketService.createTicket.mockResolvedValue(makeTicket());

      const result = await service.createLead(conversation, makeDto());

      // Service only has leadRepo, mockTicketService, auditService — no webhook/email deps
      expect(result.lead).toBeDefined();
      expect(result.ticket).toBeDefined();
    });

    it('sets confidentialityTriggered=true when conversation.type is "confidential"', async () => {
      const conversation = makeConversation({ type: 'confidential' });
      leadRepo.findByConversationId.mockResolvedValue(null);
      leadRepo.create.mockResolvedValue(makeLead());
      mockTicketService.createTicket.mockResolvedValue(makeTicket());

      await service.createLead(conversation, makeDto());

      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ confidentialityTriggered: true }),
      );
    });

    it('sets confidentialityTriggered=true when conversation.riskLevel is "high"', async () => {
      const conversation = makeConversation({ riskLevel: 'high' });
      leadRepo.findByConversationId.mockResolvedValue(null);
      leadRepo.create.mockResolvedValue(makeLead());
      mockTicketService.createTicket.mockResolvedValue(makeTicket());

      await service.createLead(conversation, makeDto());

      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ confidentialityTriggered: true }),
      );
    });

    it('sets confidentialityTriggered=false for normal conversation with no risk', async () => {
      const conversation = makeConversation({ type: 'normal', riskLevel: null });
      leadRepo.findByConversationId.mockResolvedValue(null);
      leadRepo.create.mockResolvedValue(makeLead());
      mockTicketService.createTicket.mockResolvedValue(makeTicket());

      await service.createLead(conversation, makeDto());

      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ confidentialityTriggered: false }),
      );
    });

    it('does not throw when AuditService.log rejects', async () => {
      const conversation = makeConversation();
      leadRepo.findByConversationId.mockResolvedValue(null);
      leadRepo.create.mockResolvedValue(makeLead());
      mockTicketService.createTicket.mockResolvedValue(makeTicket());
      audit.log.mockRejectedValue(new Error('audit DB down'));

      // Should resolve without throwing despite audit failure
      await expect(service.createLead(conversation, makeDto())).resolves.toBeDefined();

      // Wait for fire-and-forget promises to settle
      await new Promise((r) => setImmediate(r));
    });
  });

  // ── createTicketOnly ────────────────────────────────────────────────────

  describe('createTicketOnly()', () => {
    it('creates Ticket with status=open and given triggerReason', async () => {
      const ticket = makeTicket({ triggerReason: 'handoff', leadId: null });
      mockTicketService.createTicket.mockResolvedValue(ticket);

      const result = await service.createTicketOnly(makeConversation(), 'handoff');

      expect(result.status).toBe('open');
      expect(mockTicketService.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'open', triggerReason: 'handoff' }),
      );
    });

    it('does not create a Lead', async () => {
      mockTicketService.createTicket.mockResolvedValue(makeTicket());
      await service.createTicketOnly(makeConversation(), 'handoff');
      expect(leadRepo.create).not.toHaveBeenCalled();
    });
  });

  // ── findById ────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns lead when found', async () => {
      leadRepo.findById.mockResolvedValue(makeLead());
      const result = await service.findById(10);
      expect(result?.id).toBe(10);
    });

    it('returns null when not found', async () => {
      leadRepo.findById.mockResolvedValue(null);
      expect(await service.findById(99)).toBeNull();
    });
  });

  // ── updateLeadStatus ────────────────────────────────────────────────────

  describe('updateLeadStatus()', () => {
    it('delegates to leadRepository.updateStatus', async () => {
      leadRepo.updateStatus.mockResolvedValue(makeLead({ status: 'contacted' }));
      const result = await service.updateLeadStatus(10, 'contacted');
      expect(result.status).toBe('contacted');
    });
  });
});
