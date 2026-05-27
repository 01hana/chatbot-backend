import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LeadsAdminService } from './leads-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeLeadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    conversationId: 10,
    name: 'Alice',
    email: 'alice@example.com',
    company: 'ACME',
    phone: '0912345678',
    message: 'Need help',
    language: 'zh-TW',
    type: 'general',
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
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    deletedAt: null,
    conversation: { session_token: 'token-uuid-1', sessionId: 'sess-uuid-1', status: 'active' },
    tickets: [],
    ...overrides,
  };
}

function makeLeadDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    ...makeLeadRow(overrides),
    conversation: {
      id: 10,
      sessionId: 'sess-uuid-1',
      session_token: 'token-uuid-1',
      status: 'active',
      _count: { messages: 5 },
    },
    tickets: [],
    ...overrides,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  lead: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
};

const mockAudit = {
  log: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LeadsAdminService', () => {
  let service: LeadsAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsAdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<LeadsAdminService>(LeadsAdminService);
    jest.clearAllMocks();
  });

  // ── 1. list — pagination ──────────────────────────────────────────────────

  describe('list()', () => {
    it('should use default pagination (page=1, pageSize=20)', async () => {
      const rows = [makeLeadRow()];
      (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mockResolvedValue(rows as never);
      (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>).mockResolvedValue(1 as never);

      const result = await service.list({});

      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
      expect(result.meta.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Alice');
      expect(result.data[0].sessionToken).toBe('token-uuid-1');
    });

    it('should clamp pageSize to 100', async () => {
      (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mockResolvedValue([] as never);
      (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>).mockResolvedValue(0 as never);

      await service.list({ pageSize: 999 });

      const call = (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mock.calls[0][0] as { take: number };
      expect(call.take).toBe(100);
    });

    // ── 2. keyword search ────────────────────────────────────────────────────

    it('should filter by keyword (name/email/company/message)', async () => {
      (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mockResolvedValue([] as never);
      (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>).mockResolvedValue(0 as never);

      const query: ListLeadsQueryDto = { keyword: 'alice' };
      await service.list(query);

      const call = (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
      const orClause = call.where.AND.find((c) => (c as Record<string, unknown>).OR !== undefined) as
        | { OR: { name: unknown }[] }
        | undefined;
      expect(orClause).toBeDefined();
      expect(orClause?.OR).toHaveLength(4); // name, email, company, message
    });

    // ── 3. status filter ─────────────────────────────────────────────────────

    it('should filter by status', async () => {
      (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mockResolvedValue([] as never);
      (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>).mockResolvedValue(0 as never);

      await service.list({ status: 'contacted' });

      const call = (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
      const statusClause = call.where.AND.find((c) => (c as Record<string, unknown>).status !== undefined);
      expect((statusClause as Record<string, unknown>)?.status).toBe('contacted');
    });

    // ── 4. notificationStatus filter ─────────────────────────────────────────

    it('should filter by notificationStatus', async () => {
      (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mockResolvedValue([] as never);
      (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>).mockResolvedValue(0 as never);

      await service.list({ notificationStatus: 'success' });

      const call = (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
      const nsClause = call.where.AND.find((c) => (c as Record<string, unknown>).notificationStatus !== undefined);
      expect((nsClause as Record<string, unknown>)?.notificationStatus).toBe('success');
    });

    // ── 5. type filter ────────────────────────────────────────────────────────

    it('should filter by type', async () => {
      (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mockResolvedValue([] as never);
      (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>).mockResolvedValue(0 as never);

      await service.list({ type: 'confidential' });

      const call = (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
      const typeClause = call.where.AND.find((c) => (c as Record<string, unknown>).type !== undefined);
      expect((typeClause as Record<string, unknown>)?.type).toBe('confidential');
    });

    // ── 6. date range filter ──────────────────────────────────────────────────

    it('should filter by date range', async () => {
      (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mockResolvedValue([] as never);
      (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>).mockResolvedValue(0 as never);

      await service.list({ dateFrom: '2024-01-01', dateTo: '2024-12-31' });

      const call = (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
      const dateClause = call.where.AND.find(
        (c) => (c as Record<string, unknown>).createdAt !== undefined,
      ) as { createdAt: { gte: Date; lte: Date } } | undefined;
      expect(dateClause?.createdAt?.gte).toBeInstanceOf(Date);
      expect(dateClause?.createdAt?.lte).toBeInstanceOf(Date);
    });

    it('should return VM with sessionToken and ticketId', async () => {
      const row = makeLeadRow({ tickets: [{ id: 5, status: 'open' }] });
      (mockPrisma.lead.findMany as jest.MockedFunction<typeof mockPrisma.lead.findMany>).mockResolvedValue([row] as never);
      (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>).mockResolvedValue(1 as never);

      const result = await service.list({});

      expect(result.data[0].sessionToken).toBe('token-uuid-1');
      expect(result.data[0].ticketId).toBe(5);
    });
  });

  // ── 7. findOne — detail ───────────────────────────────────────────────────

  describe('findOne()', () => {
    it('should throw NotFoundException when lead not found', async () => {
      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(null as never);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    it('should return detail with conversationSummary, relatedTicket, and timeline', async () => {
      const row = makeLeadDetailRow({
        status: 'contacted',
        tickets: [
          {
            id: 5,
            status: 'open',
            priority: 'medium',
            triggerReason: 'handoff',
            createdAt: new Date('2024-01-01T00:00:00Z'),
          },
        ],
      });
      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(row as never);

      const result = await service.findOne(1);

      expect(result.id).toBe(1);
      expect(result.sessionToken).toBe('token-uuid-1');
      expect(result.conversationSummary).toBeDefined();
      expect(result.conversationSummary?.messageCount).toBe(5);
      expect(result.relatedTicket?.id).toBe(5);
      expect(result.relatedTicket?.status).toBe('open');
      // Timeline should include lead_created and status_changed
      const events = result.timeline.map((e) => e.event);
      expect(events).toContain('lead_created');
      expect(events).toContain('status_changed');
    });
  });

  // ── 8. update — PATCH /:id ────────────────────────────────────────────────

  describe('update()', () => {
    it('should throw NotFoundException when lead not found', async () => {
      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(null as never);

      await expect(service.update(999, {})).rejects.toThrow(NotFoundException);
    });

    it('should update status and fire audit log', async () => {
      const existing = makeLeadRow({ status: 'new', notes: null });
      const updated = makeLeadRow({ status: 'contacted' });

      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(existing as never);
      (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mockResolvedValue(updated as never);
      (mockAudit.log as jest.MockedFunction<typeof mockAudit.log>).mockResolvedValue(undefined as never);

      const dto: UpdateLeadDto = { status: 'contacted' };
      const result = await service.update(1, dto);

      expect(result.status).toBe('contacted');
      // Update called with correct status
      const updateCall = (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mock.calls[0][0] as {
        data: { status: string };
      };
      expect(updateCall.data.status).toBe('contacted');
    });

    it('should append note to existing notes', async () => {
      const existing = makeLeadRow({ notes: 'old note' });
      const updated = makeLeadRow({ notes: 'old note\nnew note' });

      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(existing as never);
      (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mockResolvedValue(updated as never);

      const dto: UpdateLeadDto = { note: 'new note' };
      await service.update(1, dto);

      const updateCall = (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mock.calls[0][0] as {
        data: { notes: string };
      };
      expect(updateCall.data.notes).toBe('old note\nnew note');
    });

    it('should set note when existing notes is null', async () => {
      const existing = makeLeadRow({ notes: null });
      const updated = makeLeadRow({ notes: 'first note' });

      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(existing as never);
      (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mockResolvedValue(updated as never);

      await service.update(1, { note: 'first note' });

      const updateCall = (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mock.calls[0][0] as {
        data: { notes: string };
      };
      expect(updateCall.data.notes).toBe('first note');
    });

    it('should not append a blank / whitespace-only note', async () => {
      const existing = makeLeadRow({ notes: 'old note' });

      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(existing as never);
      (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mockResolvedValue(
        makeLeadRow({ notes: 'old note' }) as never,
      );

      await service.update(1, { note: '   ' });

      const updateCall = (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      // notes field must NOT be present in the update payload
      expect(updateCall.data.notes).toBeUndefined();
    });

    it('should trim note before appending', async () => {
      const existing = makeLeadRow({ notes: null });
      const updated = makeLeadRow({ notes: 'hello' });

      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(existing as never);
      (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mockResolvedValue(updated as never);

      await service.update(1, { note: '  hello  ' });

      const updateCall = (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mock.calls[0][0] as {
        data: { notes: string };
      };
      expect(updateCall.data.notes).toBe('hello');
    });
  });

  // ── 9. updateStatus — PATCH /:id/status ──────────────────────────────────

  describe('updateStatus()', () => {
    it('should throw NotFoundException when lead not found', async () => {
      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(null as never);

      await expect(service.updateStatus(999, { status: 'contacted' })).rejects.toThrow(NotFoundException);
    });

    it('should update status and audit log', async () => {
      const existing = makeLeadRow({ status: 'new' });
      const updated = makeLeadRow({ status: 'qualified' });

      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(existing as never);
      (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mockResolvedValue(updated as never);
      (mockAudit.log as jest.MockedFunction<typeof mockAudit.log>).mockResolvedValue(undefined as never);

      const dto: UpdateLeadStatusDto = { status: 'qualified' };
      const result = await service.updateStatus(1, dto);

      expect(result.status).toBe('qualified');
      const updateCall = (mockPrisma.lead.update as jest.MockedFunction<typeof mockPrisma.lead.update>).mock.calls[0][0] as {
        data: { status: string };
      };
      expect(updateCall.data.status).toBe('qualified');
    });
  });

  // ── 10. getNotifications — deferred empty response ────────────────────────

  describe('getNotifications()', () => {
    it('should throw NotFoundException when lead not found', async () => {
      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue(null as never);

      await expect(service.getNotifications(999)).rejects.toThrow(NotFoundException);
    });

    it('should return empty notification list for existing lead (deferred)', async () => {
      (mockPrisma.lead.findUnique as jest.MockedFunction<typeof mockPrisma.lead.findUnique>).mockResolvedValue({ id: 1 } as never);

      const result = await service.getNotifications(1);

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.page).toBe(1);
    });
  });
});
