import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TicketService } from '../../ticket/ticket.service';
import { TicketsAdminService } from './tickets-admin.service';
import type { TicketRepository, TicketWithLead, TicketWithRelations } from '../../ticket/ticket.repository';
import type { AuditService } from '../../audit/audit.service';
import type { Ticket } from '../../generated/prisma/client';

// ─── Factories ───────────────────────────────────────────────────────────────

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    leadId: null,
    conversationId: 10,
    status: 'open',
    triggerReason: 'handoff',
    summary: null,
    priority: 'medium',
    assignee: null,
    notes: [],
    resolvedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeTicketWithLead(overrides: Partial<Ticket> = {}): TicketWithLead {
  return {
    ...makeTicket(overrides),
    lead: null,
  };
}

function makeTicketWithRelations(overrides: Partial<Ticket> = {}): TicketWithRelations {
  return {
    ...makeTicket(overrides),
    lead: null,
    conversation: {
      id: 10,
      sessionId: 'sess-internal-uuid',
      session_token: 'sess-ext-token',
    },
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

type MockRepo = {
  [K in keyof TicketRepository]: jest.MockedFunction<TicketRepository[K]>;
};

type MockAudit = {
  log: jest.MockedFunction<AuditService['log']>;
};

function makeMockRepo(): MockRepo {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByIdWithRelations: jest.fn(),
    findByConversationId: jest.fn(),
    list: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    addNote: jest.fn(),
  } as unknown as MockRepo;
}

// ─── TicketService tests ──────────────────────────────────────────────────────

describe('TicketService', () => {
  let service: TicketService;
  let repo: MockRepo;
  let audit: MockAudit;

  beforeEach(() => {
    repo = makeMockRepo();
    audit = { log: jest.fn<AuditService['log']>().mockResolvedValue(undefined) };
    service = new TicketService(
      repo as unknown as TicketRepository,
      audit as unknown as AuditService,
    );
  });

  afterEach(() => { jest.clearAllMocks(); });

  // ── validateTicketStatus ─────────────────────────────────────────────────

  describe('validateTicketStatus()', () => {
    it('accepts valid statuses', () => {
      expect(service.validateTicketStatus('open')).toBe('open');
      expect(service.validateTicketStatus('in_progress')).toBe('in_progress');
      expect(service.validateTicketStatus('resolved')).toBe('resolved');
      expect(service.validateTicketStatus('closed')).toBe('closed');
    });

    it('throws BadRequestException for invalid status', () => {
      expect(() => service.validateTicketStatus('pending')).toThrow(BadRequestException);
      expect(() => service.validateTicketStatus('')).toThrow(BadRequestException);
      expect(() => service.validateTicketStatus('OPEN')).toThrow(BadRequestException);
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns ticket when found', async () => {
      repo.findById.mockResolvedValue(makeTicket({ id: 5 }));
      const result = await service.findById(5);
      expect(result.id).toBe(5);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ── list ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns paginated items', async () => {
      const items = [makeTicketWithLead(), makeTicketWithLead({ id: 2 })];
      repo.list.mockResolvedValue({ items, total: 2 });

      const result = await service.list({ skip: 0, take: 20 });

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
    });

    it('forwards status filter to repository', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });
      await service.list({ status: 'open' });
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
    });

    it('forwards priority filter to repository', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });
      await service.list({ priority: 'high' });
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ priority: 'high' }));
    });

    it('forwards keyword filter to repository', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });
      await service.list({ keyword: 'test' });
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'test' }));
    });
  });

  // ── updateTicketStatus ────────────────────────────────────────────────────

  describe('updateTicketStatus()', () => {
    it('updates status for valid transition open → in_progress', async () => {
      const ticket = makeTicket({ status: 'open' });
      repo.findById.mockResolvedValue(ticket);
      repo.update.mockResolvedValue({ ...ticket, status: 'in_progress' });

      const result = await service.updateTicketStatus(1, 'in_progress');
      expect(result.status).toBe('in_progress');
    });

    it('sets resolvedAt when status → resolved', async () => {
      const ticket = makeTicket({ status: 'in_progress', resolvedAt: null });
      repo.findById.mockResolvedValue(ticket);
      repo.update.mockImplementation(async (_id, data) =>
        ({ ...ticket, ...data, status: 'resolved' }) as Ticket,
      );

      await service.updateTicketStatus(1, 'resolved');

      expect(repo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) }),
      );
    });

    it('clears resolvedAt when reverting resolved → open', async () => {
      const resolvedAt = new Date('2026-01-02T00:00:00Z');
      const ticket = makeTicket({ status: 'resolved', resolvedAt });
      repo.findById.mockResolvedValue(ticket);
      repo.update.mockImplementation(async (_id, data) =>
        ({ ...ticket, ...data, status: 'open' }) as Ticket,
      );

      await service.updateTicketStatus(1, 'open');

      expect(repo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'open', resolvedAt: null }),
      );
    });

    it('clears resolvedAt when reverting resolved → in_progress', async () => {
      const ticket = makeTicket({ status: 'resolved', resolvedAt: new Date() });
      repo.findById.mockResolvedValue(ticket);
      repo.update.mockResolvedValue({ ...ticket, status: 'in_progress', resolvedAt: null });

      await service.updateTicketStatus(1, 'in_progress');

      expect(repo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'in_progress', resolvedAt: null }),
      );
    });

    it('throws BadRequestException for invalid status string', async () => {
      await expect(service.updateTicketStatus(1, 'unknown')).rejects.toThrow(BadRequestException);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when ticket not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.updateTicketStatus(99, 'open')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when trying to re-open a closed ticket', async () => {
      repo.findById.mockResolvedValue(makeTicket({ status: 'closed' }));
      await expect(service.updateTicketStatus(1, 'open')).rejects.toThrow(BadRequestException);
    });
  });

  // ── addTicketNote ─────────────────────────────────────────────────────────

  describe('addTicketNote()', () => {
    it('appends note to ticket', async () => {
      const ticket = makeTicket({ notes: [] });
      repo.findById.mockResolvedValue(ticket);
      repo.addNote.mockResolvedValue({ ...ticket, notes: [{ id: 1, content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' }] });

      const result = await service.addTicketNote(1, 'hi');

      expect(repo.addNote).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ content: 'hi', id: 1 }),
      );
      expect(result).toBeDefined();
    });

    it('throws NotFoundException when ticket not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.addTicketNote(99, 'note')).rejects.toThrow(NotFoundException);
    });

    it('assigns sequential id based on existing notes length', async () => {
      const existingNotes = [
        { id: 1, content: 'first', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 2, content: 'second', createdAt: '2026-01-01T00:00:01.000Z' },
      ];
      const ticket = makeTicket({ notes: existingNotes });
      repo.findById.mockResolvedValue(ticket);
      repo.addNote.mockResolvedValue({ ...ticket });

      await service.addTicketNote(1, 'third');

      expect(repo.addNote).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ id: 3, content: 'third' }),
      );
    });

    it('throws BadRequestException for blank content', async () => {
      await expect(service.addTicketNote(1, '')).rejects.toThrow(BadRequestException);
      await expect(service.addTicketNote(1, '   ')).rejects.toThrow(BadRequestException);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('trims whitespace from content before storing', async () => {
      const ticket = makeTicket({ notes: [] });
      repo.findById.mockResolvedValue(ticket);
      repo.addNote.mockResolvedValue({ ...ticket });

      await service.addTicketNote(1, '  hello  ');

      expect(repo.addNote).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ content: 'hello' }),
      );
    });

    it('audit reject does not throw from addTicketNote', async () => {
      const ticket = makeTicket({ notes: [] });
      repo.findById.mockResolvedValue(ticket);
      repo.addNote.mockResolvedValue({ ...ticket });
      audit.log.mockRejectedValue(new Error('audit down'));

      await expect(service.addTicketNote(1, 'note')).resolves.toBeDefined();
      await new Promise((r) => setImmediate(r));
    });
  });

  // ── updateTicketStatus — audit ────────────────────────────────────────────

  describe('updateTicketStatus() — audit', () => {
    it('audit reject does not throw from updateTicketStatus', async () => {
      const ticket = makeTicket({ status: 'open' });
      repo.findById.mockResolvedValue(ticket);
      repo.update.mockResolvedValue({ ...ticket, status: 'in_progress' });
      audit.log.mockRejectedValue(new Error('audit down'));

      await expect(service.updateTicketStatus(1, 'in_progress')).resolves.toBeDefined();
      await new Promise((r) => setImmediate(r));
    });
  });
});

// ─── TicketsAdminService tests ────────────────────────────────────────────────

describe('TicketsAdminService', () => {
  let adminService: TicketsAdminService;
  let ticketService: jest.Mocked<TicketService>;

  beforeEach(() => {
    ticketService = {
      createTicket: jest.fn(),
      findById: jest.fn(),
      findByIdWithRelations: jest.fn(),
      list: jest.fn(),
      updateTicketStatus: jest.fn(),
      addTicketNote: jest.fn(),
      validateTicketStatus: jest.fn(),
      validateTicketPriority: jest.fn(),
    } as unknown as jest.Mocked<TicketService>;
    adminService = new TicketsAdminService(ticketService);
  });

  afterEach(() => { jest.clearAllMocks(); });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns paginated data with meta', async () => {
      const items = [makeTicketWithLead(), makeTicketWithLead({ id: 2 })];
      ticketService.list.mockResolvedValue({ items, total: 2 });

      const result = await adminService.list({ page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({ total: 2, page: 1, pageSize: 20 });
    });

    it('uses default page=1 and pageSize=20 when not specified', async () => {
      ticketService.list.mockResolvedValue({ items: [], total: 0 });

      await adminService.list({});

      expect(ticketService.list).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('computes correct skip from page', async () => {
      ticketService.list.mockResolvedValue({ items: [], total: 0 });

      await adminService.list({ page: 3, pageSize: 10 });

      expect(ticketService.list).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('forwards status filter', async () => {
      ticketService.list.mockResolvedValue({ items: [], total: 0 });
      await adminService.list({ status: 'open' });
      expect(ticketService.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'open' }),
      );
    });

    it('forwards priority filter', async () => {
      ticketService.list.mockResolvedValue({ items: [], total: 0 });
      await adminService.list({ priority: 'high' });
      expect(ticketService.list).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'high' }),
      );
    });

    it('forwards keyword search', async () => {
      ticketService.list.mockResolvedValue({ items: [], total: 0 });
      await adminService.list({ keyword: 'escalation' });
      expect(ticketService.list).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'escalation' }),
      );
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('returns ticket detail VM', async () => {
      const ticket = makeTicketWithRelations({ id: 7 });
      ticketService.findByIdWithRelations.mockResolvedValue(ticket);

      const result = await adminService.findOne(7);

      expect(result.id).toBe(7);
      expect(result.timeline).toBeDefined();
      expect(Array.isArray(result.timeline)).toBe(true);
    });

    it('detail includes conversation info with sessionToken', async () => {
      const ticket = makeTicketWithRelations({ id: 7 });
      ticketService.findByIdWithRelations.mockResolvedValue(ticket);

      const result = await adminService.findOne(7);

      expect(result.conversation?.sessionToken).toBe('sess-ext-token');
    });

    it('timeline has at least ticket_created event', async () => {
      const ticket = makeTicketWithRelations();
      ticketService.findByIdWithRelations.mockResolvedValue(ticket);

      const result = await adminService.findOne(1);

      const createdEvent = result.timeline.find((e) => e.event === 'ticket_created');
      expect(createdEvent).toBeDefined();
    });

    it('timeline includes note_added events', async () => {
      const notes = [{ id: 1, content: 'admin comment', createdAt: '2026-01-02T00:00:00.000Z' }];
      const ticket = makeTicketWithRelations({ notes });
      ticketService.findByIdWithRelations.mockResolvedValue(ticket);

      const result = await adminService.findOne(1);

      const noteEvent = result.timeline.find((e) => e.event === 'note_added');
      expect(noteEvent).toBeDefined();
      expect(noteEvent?.content).toBe('admin comment');
    });

    it('timeline includes resolved event when resolvedAt is set', async () => {
      const resolvedAt = new Date('2026-01-05T00:00:00Z');
      const ticket = makeTicketWithRelations({ status: 'resolved', resolvedAt });
      ticketService.findByIdWithRelations.mockResolvedValue(ticket);

      const result = await adminService.findOne(1);

      const resolvedEvent = result.timeline.find((e) => e.event === 'resolved');
      expect(resolvedEvent).toBeDefined();
    });

    it('throws NotFoundException when ticket not found (delegated from TicketService)', async () => {
      ticketService.findByIdWithRelations.mockRejectedValue(new NotFoundException('Ticket 99 not found'));
      await expect(adminService.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateStatus ──────────────────────────────────────────────────────────

  describe('updateStatus()', () => {
    it('returns updated TicketVm on valid status', async () => {
      const ticket = makeTicketWithLead({ status: 'in_progress' });
      ticketService.updateTicketStatus.mockResolvedValue(ticket as Ticket);

      const result = await adminService.updateStatus(1, 'in_progress');
      expect(result.status).toBe('in_progress');
    });

    it('propagates BadRequestException for invalid status', async () => {
      ticketService.updateTicketStatus.mockRejectedValue(new BadRequestException('Invalid status'));
      await expect(adminService.updateStatus(1, 'bad')).rejects.toThrow(BadRequestException);
    });
  });

  // ── addNote ───────────────────────────────────────────────────────────────

  describe('addNote()', () => {
    it('returns updated TicketVm after adding note', async () => {
      const notes = [{ id: 1, content: 'test note', createdAt: '2026-01-01T00:00:00.000Z' }];
      const updated = makeTicketWithLead({ notes });
      ticketService.addTicketNote.mockResolvedValue(updated as Ticket);

      const result = await adminService.addNote(1, 'test note');
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].content).toBe('test note');
    });

    it('propagates NotFoundException when ticket not found', async () => {
      ticketService.addTicketNote.mockRejectedValue(new NotFoundException('Ticket 99 not found'));
      await expect(adminService.addNote(99, 'note')).rejects.toThrow(NotFoundException);
    });
  });

  // ── TicketVm shape ────────────────────────────────────────────────────────

  describe('TicketVm', () => {
    it('includes title derived from summary when summary is set', async () => {
      const ticket = makeTicketWithLead({ summary: 'My Summary', triggerReason: 'handoff' });
      ticketService.list.mockResolvedValue({ items: [ticket], total: 1 });

      const result = await adminService.list({ page: 1, pageSize: 20 });
      expect(result.data[0].title).toBe('My Summary');
    });

    it('includes title derived from triggerReason when summary is null', async () => {
      const ticket = makeTicketWithLead({ summary: null, triggerReason: 'handoff' });
      ticketService.list.mockResolvedValue({ items: [ticket], total: 1 });

      const result = await adminService.list({ page: 1, pageSize: 20 });
      expect(result.data[0].title).toBe('handoff');
    });

    it('createdAt and updatedAt are ISO strings', async () => {
      const ticket = makeTicketWithLead();
      ticketService.list.mockResolvedValue({ items: [ticket], total: 1 });

      const result = await adminService.list({ page: 1, pageSize: 20 });
      expect(typeof result.data[0].createdAt).toBe('string');
      expect(result.data[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(typeof result.data[0].updatedAt).toBe('string');
    });

    it('resolvedAt is ISO string when set, null otherwise', async () => {
      const resolvedAt = new Date('2026-01-05T12:00:00Z');
      const ticketResolved = makeTicketWithLead({ status: 'resolved', resolvedAt });
      const ticketOpen = makeTicketWithLead();
      ticketService.list.mockResolvedValue({ items: [ticketResolved, ticketOpen], total: 2 });

      const result = await adminService.list({ page: 1, pageSize: 20 });
      expect(result.data[0].resolvedAt).toBe('2026-01-05T12:00:00.000Z');
      expect(result.data[1].resolvedAt).toBeNull();
    });
  });
});
