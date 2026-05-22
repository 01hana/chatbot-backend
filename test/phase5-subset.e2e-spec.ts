/**
 * phase5-subset.e2e-spec.ts — T5-014/T5-015 Phase 5 subset checkpoint
 *
 * Validates the Phase 5 subset required for Front-end Phase 3:
 *  1. Lead + Handoff integration
 *  2. Ticket admin CRUD
 *  3. Feedback API
 *  4. Existing Chat API regression guard
 *
 * Uses a stateful in-memory PrismaService mock to avoid Prisma 7 WASM
 * incompatibility with Jest's CJS runtime. All service logic still executes
 * through real NestJS modules; only the Prisma client is swapped out.
 *
 * Run: npm run test:e2e -- --testPathPattern=phase5-subset --forceExit
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';

import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

// ─── Stateful in-memory store ─────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

function matchesWhere(item: AnyRecord, where?: AnyRecord): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (['AND', 'OR', 'NOT'].includes(key)) continue;
    if (value === null || value === undefined) {
      if (item[key] !== null && item[key] !== undefined) return false;
      continue;
    }
    if (typeof value === 'object') continue; // skip complex operators (contains, gte …)
    if (item[key] !== value) return false;
  }
  return true;
}

function buildStatefulMock() {
  let idSeq = 1;
  const nextId = () => idSeq++;

  // stores
  const conversations = new Map<number, AnyRecord>();
  const conversationByToken = new Map<string, AnyRecord>();
  const conversationMessages = new Map<number, AnyRecord>();
  const leads = new Map<number, AnyRecord>();
  const tickets = new Map<number, AnyRecord>();
  const feedbacks = new Map<number, AnyRecord>();

  const now = () => new Date();

  const conversation = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const row: AnyRecord = {
        id,
        sessionId: randomUUID(),
        session_token: randomUUID(),
        status: 'active',
        type: 'normal',
        language: (data.language as string) ?? 'zh-TW',
        riskLevel: null,
        sensitiveIntentCount: 0,
        highIntentScore: 0,
        diagnosisContext: null,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null,
      };
      conversations.set(id, row);
      conversationByToken.set(row.session_token as string, row);
      return Promise.resolve(row);
    },
    findUnique({ where, include }: { where: AnyRecord; include?: AnyRecord }) {
      let row: AnyRecord | undefined;
      if (where.session_token !== undefined) {
        row = conversationByToken.get(where.session_token as string);
      } else if (where.id !== undefined) {
        row = conversations.get(where.id as number);
      }
      if (!row) return Promise.resolve(null);
      // include.messages — return recent messages if requested
      if (include?.messages) {
        const msgs = Array.from(conversationMessages.values()).filter(
          (m) => m.conversationId === row!.id,
        );
        return Promise.resolve({ ...row, messages: msgs });
      }
      return Promise.resolve({ ...row });
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(conversations.values()).find((r) =>
        matchesWhere(r, where),
      );
      return Promise.resolve(result ?? null);
    },
    update({ where, data }: { where: AnyRecord; data: AnyRecord }) {
      const row = conversations.get(where.id as number);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data, { updatedAt: now() });
      return Promise.resolve(row);
    },
  };

  const conversationMessage = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const row: AnyRecord = {
        id,
        conversationId: data.conversationId,
        role: data.role,
        content: data.content,
        type: (data.type as string) ?? 'text',
        createdAt: now(),
        updatedAt: now(),
      };
      conversationMessages.set(id, row);
      return Promise.resolve(row);
    },
    findUnique({ where }: { where: AnyRecord }) {
      return Promise.resolve(conversationMessages.get(where.id as number) ?? null);
    },
    findMany({
      where,
      orderBy,
      take,
    }: {
      where?: AnyRecord;
      orderBy?: AnyRecord;
      take?: number;
    }) {
      let rows = Array.from(conversationMessages.values()).filter((r) =>
        matchesWhere(r, where),
      );
      if (orderBy?.createdAt === 'desc') rows = rows.reverse();
      if (take !== undefined) rows = rows.slice(0, take);
      return Promise.resolve(rows);
    },
  };

  const lead = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const conversationId = (data.conversation as AnyRecord)?.connect
        ? ((data.conversation as AnyRecord).connect as AnyRecord).id
        : data.conversationId;
      const row: AnyRecord = {
        id,
        conversationId,
        name: data.name,
        email: data.email,
        company: data.company ?? null,
        phone: data.phone ?? null,
        message: data.message ?? null,
        language: data.language ?? null,
        type: data.type ?? 'general',
        riskLevel: data.riskLevel ?? null,
        status: data.status ?? 'new',
        confidentialityTriggered: data.confidentialityTriggered ?? false,
        promptInjectionDetected: data.promptInjectionDetected ?? false,
        sensitiveIntentCount: data.sensitiveIntentCount ?? 0,
        highIntentScore: data.highIntentScore ?? 0,
        notificationStatus: data.notificationStatus ?? 'pending',
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      leads.set(id, row);
      return Promise.resolve(row);
    },
    findUnique({ where }: { where: AnyRecord }) {
      return Promise.resolve(leads.get(where.id as number) ?? null);
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(leads.values()).find((r) => matchesWhere(r, where));
      return Promise.resolve(result ?? null);
    },
  };

  const ticket = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const conversationId = (data.conversation as AnyRecord)?.connect
        ? ((data.conversation as AnyRecord).connect as AnyRecord).id
        : data.conversationId;
      const leadId = (data.lead as AnyRecord)?.connect
        ? ((data.lead as AnyRecord).connect as AnyRecord).id
        : (data.leadId as number | null | undefined) ?? null;
      const row: AnyRecord = {
        id,
        conversationId,
        leadId,
        status: (data.status as string) ?? 'open',
        priority: (data.priority as string) ?? 'normal',
        triggerReason: data.triggerReason ?? null,
        summary: data.summary ?? null,
        assignee: data.assignee ?? null,
        notes: Array.isArray(data.notes) ? [...(data.notes as unknown[])] : [],
        resolvedAt: null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      tickets.set(id, row);
      return Promise.resolve(row);
    },
    findUnique({
      where,
      include,
    }: {
      where: AnyRecord;
      include?: AnyRecord;
    }) {
      const row = tickets.get(where.id as number);
      if (!row) return Promise.resolve(null);
      const result = { ...row };
      if (include?.lead) {
        const l = row.leadId ? leads.get(row.leadId as number) : null;
        (result as AnyRecord).lead = l
          ? {
              id: l.id,
              name: l.name,
              email: l.email,
              company: l.company,
              phone: l.phone ?? null,
            }
          : null;
      }
      if (include?.conversation) {
        const c = conversations.get(row.conversationId as number);
        (result as AnyRecord).conversation = c
          ? { id: c.id, sessionId: c.sessionId, session_token: c.session_token }
          : null;
      }
      return Promise.resolve(result);
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(tickets.values()).find((r) => matchesWhere(r, where));
      return Promise.resolve(result ?? null);
    },
    findMany({
      where,
      skip,
      take,
      orderBy,
      include,
    }: {
      where?: AnyRecord;
      skip?: number;
      take?: number;
      orderBy?: AnyRecord;
      include?: AnyRecord;
    }) {
      let rows = Array.from(tickets.values()).filter((r) => matchesWhere(r, where));
      if (skip !== undefined) rows = rows.slice(skip);
      if (take !== undefined) rows = rows.slice(0, take);
      if (include?.lead) {
        rows = rows.map((r) => {
          const l = r.leadId ? leads.get(r.leadId as number) : null;
          return {
            ...r,
            lead: l
              ? { id: l.id, name: l.name, email: l.email, company: l.company }
              : null,
          };
        });
      }
      return Promise.resolve(rows);
    },
    count({ where }: { where?: AnyRecord }) {
      const count = Array.from(tickets.values()).filter((r) =>
        matchesWhere(r, where),
      ).length;
      return Promise.resolve(count);
    },
    update({ where, data }: { where: AnyRecord; data: AnyRecord }) {
      const row = tickets.get(where.id as number);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data, { updatedAt: now() });
      return Promise.resolve(row);
    },
  };

  const feedback = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const row: AnyRecord = {
        id,
        conversationId: data.conversationId,
        messageId: data.messageId,
        value: data.value,
        reason: data.reason ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      feedbacks.set(id, row);
      return Promise.resolve(row);
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(feedbacks.values()).find((r) =>
        matchesWhere(r, where),
      );
      return Promise.resolve(result ?? null);
    },
    findMany({ where }: { where?: AnyRecord }) {
      return Promise.resolve(
        Array.from(feedbacks.values()).filter((r) => matchesWhere(r, where)),
      );
    },
    deleteMany({ where }: { where?: AnyRecord }) {
      const toDelete: number[] = [];
      for (const [id, row] of feedbacks.entries()) {
        if (matchesWhere(row, where)) toDelete.push(id);
      }
      for (const id of toDelete) feedbacks.delete(id);
      return Promise.resolve({ count: toDelete.length });
    },
    count({ where }: { where?: AnyRecord }) {
      return Promise.resolve(
        Array.from(feedbacks.values()).filter((r) => matchesWhere(r, where)).length,
      );
    },
    groupBy({
      by,
      where,
      _count,
    }: {
      by: string[];
      where?: AnyRecord;
      _count?: AnyRecord;
    }) {
      const rows = Array.from(feedbacks.values()).filter((r) =>
        matchesWhere(r, where),
      );
      // Group by first field in `by`
      const field = by[0];
      const groups = new Map<unknown, number>();
      for (const row of rows) {
        const key = row[field];
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      const result = Array.from(groups.entries()).map(([value, count]) => ({
        [field]: value,
        _count: _count ? { [Object.keys(_count)[0]]: count } : { _all: count },
      }));
      return Promise.resolve(result);
    },
  };

  const auditLog = {
    create() {
      return Promise.resolve({});
    },
  };

  return {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    // Static mocks for module init
    systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
    safetyRule: { findMany: jest.fn().mockResolvedValue([]) },
    blacklistEntry: { findMany: jest.fn().mockResolvedValue([]) },
    intentTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    glossaryTerm: { findMany: jest.fn().mockResolvedValue([]) },
    knowledgeEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    // Stateful stores
    conversation,
    conversationMessage,
    lead,
    ticket,
    feedback,
    auditLog,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Phase 5 subset checkpoint (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: ReturnType<typeof buildStatefulMock>;

  beforeAll(async () => {
    mockPrisma = buildStatefulMock();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── 1. Lead + Handoff integration ──────────────────────────────────────────

  describe('Lead + Handoff integration', () => {
    let sessionToken: string;
    let leadId: number;
    let ticketId: number;

    it('POST /chat/sessions → creates a session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .expect(201);

      expect(res.body.data).toHaveProperty('sessionToken');
      expect(typeof res.body.data.sessionToken).toBe('string');
      sessionToken = res.body.data.sessionToken as string;
    });

    it('POST /chat/sessions/:token/lead → creates lead + ticket', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${sessionToken}/lead`)
        .send({ name: 'Alice', email: 'alice@example.com' })
        .expect(201);

      expect(res.body.data).toHaveProperty('leadId');
      expect(res.body.data.leadId).not.toBeNull();
      expect(res.body.data).toHaveProperty('ticketId');
      expect(res.body.data.ticketId).not.toBeNull();

      leadId = res.body.data.leadId as number;
      ticketId = res.body.data.ticketId as number;

      // Verify mock state
      const storedLead = await mockPrisma.lead.findUnique({ where: { id: leadId } });
      expect(storedLead).not.toBeNull();
      expect(storedLead?.email).toBe('alice@example.com');

      const storedTicket = await mockPrisma.ticket.findUnique({
        where: { id: ticketId },
        include: { lead: true },
      });
      expect(storedTicket?.status).toBe('open');
      expect(storedTicket?.leadId).toBe(leadId);
    });

    it('POST /chat/sessions/:token/handoff → creates ticket (no lead)', async () => {
      // Create a fresh session for handoff
      const sessionRes = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .expect(201);
      const handoffToken = sessionRes.body.data.sessionToken as string;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${handoffToken}/handoff`)
        .send({ reason: 'complex_query' })
        .expect(200);

      expect(res.body.data.accepted).toBe(true);
      expect(res.body.data.action).toBe('handoff');
      expect(res.body.data.ticketId).not.toBeNull();

      const handoffTicketId = res.body.data.ticketId as number;
      const handoffTicket = await mockPrisma.ticket.findUnique({
        where: { id: handoffTicketId },
        include: {},
      });
      expect(handoffTicket?.status).toBe('open');
      expect(handoffTicket?.leadId).toBeNull();
    });
  });

  // ── 2. Ticket admin CRUD ───────────────────────────────────────────────────

  describe('Ticket admin CRUD', () => {
    let adminTicketId: number;

    beforeAll(async () => {
      // Create a dedicated session + lead → ticket for admin tests
      const sessionRes = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .expect(201);
      const token = sessionRes.body.data.sessionToken as string;

      const leadRes = await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${token}/lead`)
        .send({ name: 'Bob', email: 'bob@example.com' })
        .expect(201);

      adminTicketId = leadRes.body.data.ticketId as number;
    });

    it('GET /admin/tickets → list includes the test ticket', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/tickets')
        .expect(200);

      expect(res.body.data).toHaveProperty('data');
      expect(Array.isArray(res.body.data.data)).toBe(true);
      const found = (res.body.data.data as AnyRecord[]).find(
        (t) => t.id === adminTicketId,
      );
      expect(found).toBeDefined();
    });

    it('GET /admin/tickets/:id → returns ticket detail', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/tickets/${adminTicketId}`)
        .expect(200);

      expect(res.body.data.id).toBe(adminTicketId);
      expect(res.body.data).toHaveProperty('timeline');
      expect(Array.isArray(res.body.data.timeline)).toBe(true);
    });

    it('PATCH /admin/tickets/:id/status → open → in_progress', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/tickets/${adminTicketId}/status`)
        .send({ status: 'in_progress' })
        .expect(200);

      expect(res.body.data.status).toBe('in_progress');
    });

    it('PATCH /admin/tickets/:id/status → in_progress → resolved', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/tickets/${adminTicketId}/status`)
        .send({ status: 'resolved' })
        .expect(200);

      expect(res.body.data.status).toBe('resolved');
    });

    it('PATCH /admin/tickets/:id/status → resolved → closed', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/tickets/${adminTicketId}/status`)
        .send({ status: 'closed' })
        .expect(200);

      expect(res.body.data.status).toBe('closed');
    });

    it('PATCH /admin/tickets/:id/status → invalid status → 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/tickets/${adminTicketId}/status`)
        .send({ status: 'not_a_status' })
        .expect(400);
    });

    it('POST /admin/tickets/:id/notes → appends note', async () => {
      // Re-open via handoff to get a fresh open ticket
      const sessionRes = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .expect(201);
      const token = sessionRes.body.data.sessionToken as string;

      const leadRes = await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${token}/lead`)
        .send({ name: 'Carol', email: 'carol@example.com' })
        .expect(201);

      const noteTicketId = leadRes.body.data.ticketId as number;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/tickets/${noteTicketId}/notes`)
        .send({ content: 'This is a test note' })
        .expect(201);

      expect(res.body.data).toHaveProperty('notes');
      const notes = res.body.data.notes as AnyRecord[];
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[notes.length - 1].content).toBe('This is a test note');
    });

    it('POST /admin/tickets/:id/notes → empty content → 400', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/tickets/${adminTicketId}/notes`)
        .send({ content: '   ' })
        .expect(400);
    });
  });

  // ── 3. Feedback integration ────────────────────────────────────────────────

  describe('Feedback integration', () => {
    let feedbackToken: string;
    let messageId: number;

    beforeAll(async () => {
      // Create session
      const sessionRes = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .expect(201);
      feedbackToken = sessionRes.body.data.sessionToken as string;

      // Insert an assistant message directly into the mock store
      const conv = (await mockPrisma.conversation.findUnique({
        where: { session_token: feedbackToken },
      })) as AnyRecord;
      const msgRow = (await mockPrisma.conversationMessage.create({
        data: {
          conversationId: conv?.id,
          role: 'assistant',
          content: 'Hello, how can I help?',
          type: 'text',
        },
      })) as AnyRecord;
      messageId = msgRow.id as number;
    });

    it('POST feedback value=up → 201 with feedback object', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${feedbackToken}/messages/${messageId}/feedback`)
        .send({ value: 'up' })
        .expect(201);

      expect(res.body.data.value).toBe('up');
      expect(res.body.data.reason).toBeNull();
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('createdAt');
    });

    it('POST feedback value=down+reason → 201, upserts (only 1 feedback in store)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${feedbackToken}/messages/${messageId}/feedback`)
        .send({ value: 'down', reason: 'Not helpful' })
        .expect(201);

      expect(res.body.data.value).toBe('down');
      expect(res.body.data.reason).toBe('Not helpful');

      // Verify only 1 feedback record for this message
      const stored = await mockPrisma.feedback.findMany({ where: { messageId } });
      expect(stored.length).toBe(1);
    });

    it('POST feedback invalid value → 400', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${feedbackToken}/messages/${messageId}/feedback`)
        .send({ value: 'meh' })
        .expect(400);
    });

    it('mock feedback state: groupBy value works correctly', async () => {
      // Insert a second assistant message and add 'up' feedback to it
      const conv = (await mockPrisma.conversation.findUnique({
        where: { session_token: feedbackToken },
      })) as AnyRecord;
      const msg2 = (await mockPrisma.conversationMessage.create({
        data: {
          conversationId: conv?.id,
          role: 'assistant',
          content: 'Another response',
          type: 'text',
        },
      })) as AnyRecord;
      await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${feedbackToken}/messages/${msg2.id}/feedback`)
        .send({ value: 'up' })
        .expect(201);

      // Verify groupBy through mock
      const groups = await mockPrisma.feedback.groupBy({
        by: ['value'],
        where: { conversationId: conv?.id },
        _count: { value: true },
      });
      const upGroup = (groups as AnyRecord[]).find((g) => g.value === 'up');
      const downGroup = (groups as AnyRecord[]).find((g) => g.value === 'down');
      expect(upGroup).toBeDefined();
      expect(downGroup).toBeDefined();
    });
  });

  // ── 4. Existing Chat API — regression guard ────────────────────────────────

  describe('Existing Chat API — regression guard', () => {
    it('POST /chat/sessions → still creates a session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .expect(201);

      expect(res.body.data).toHaveProperty('sessionToken');
    });

    it('GET /chat/sessions/:token/history → returns empty array for fresh session', async () => {
      const sessionRes = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .expect(201);
      const token = sessionRes.body.data.sessionToken as string;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/chat/sessions/${token}/history`)
        .expect(200);

      expect(Array.isArray(res.body.data.messages)).toBe(true);
    });

    it('GET /chat/sessions/unknown-token/history → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/chat/sessions/nonexistent-token-xyz/history')
        .expect(404);
    });

    it('GET /widget-config → returns config with status field', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/widget/config')
        .expect(200);

      expect(res.body.data).toHaveProperty('status');
    });
  });
});
