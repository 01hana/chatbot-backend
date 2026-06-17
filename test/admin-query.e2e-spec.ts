/**
 * admin-query.e2e-spec.ts — T6-011 Admin API query endpoint checkpoint
 *
 * Validates all Phase 6 admin-facing read/write endpoints:
 *  1. Dashboard stats
 *  2. Conversations admin (list + detail)
 *  3. Audit logs admin (list + detail)
 *  4. Leads admin (list, detail, update, status)
 *  5. Tickets admin (list, detail, status update, notes)
 *  6. Feedback admin (list with filters)
 *  7. Knowledge admin (CRUD + publishing flow)
 *  8. Regression guard for chat/widget public APIs
 *
 * Uses a stateful in-memory PrismaService mock to avoid Prisma 7 WASM
 * incompatibility with Jest's CJS runtime. All NestJS service/controller logic
 * runs through real modules; only the Prisma client is swapped out.
 *
 * Run: npm run test:e2e -- --testPathPattern=admin-query --forceExit
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';

import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

// ─── Types ───────────────────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

// ─── matchesWhere — simple filter with operator support ──────────────────────

function matchesWhere(item: AnyRecord, where?: AnyRecord): boolean {
  if (!where) return true;

  for (const [key, val] of Object.entries(where)) {
    if (key === 'AND') {
      if (Array.isArray(val) && !val.every((c) => matchesWhere(item, c as AnyRecord))) return false;
      continue;
    }
    if (key === 'OR') {
      if (Array.isArray(val) && !val.some((c) => matchesWhere(item, c as AnyRecord))) return false;
      continue;
    }
    if (key === 'NOT') continue; // skip for simplicity

    if (val === null || val === undefined) {
      if (item[key] !== null && item[key] !== undefined) return false;
      continue;
    }

    if (typeof val === 'object') {
      const v = val as AnyRecord;
      if (v.in !== undefined) {
        if (!Array.isArray(v.in) || !v.in.includes(item[key])) return false;
      } else if (v.not !== undefined) {
        if (v.not === null) {
          if (item[key] === null || item[key] === undefined) return false;
        } else {
          if (item[key] === v.not) return false;
        }
      } else if (v.contains !== undefined) {
        const haystack = String(item[key] ?? '').toLowerCase();
        if (!haystack.includes(String(v.contains).toLowerCase())) return false;
      } else if (v.gte !== undefined || v.lte !== undefined) {
        const itemMs =
          item[key] instanceof Date
            ? (item[key] as Date).getTime()
            : Number(item[key]);
        if (v.gte !== undefined) {
          const gteMs =
            v.gte instanceof Date ? v.gte.getTime() : Number(v.gte);
          if (itemMs < gteMs) return false;
        }
        if (v.lte !== undefined) {
          const lteMs =
            v.lte instanceof Date ? v.lte.getTime() : Number(v.lte);
          if (itemMs > lteMs) return false;
        }
      }
      // skip other complex operators (insensitive mode, distinct, etc.)
      continue;
    }

    if (item[key] !== val) return false;
  }
  return true;
}

// ─── Stateful in-memory admin mock ───────────────────────────────────────────

function buildAdminMock() {
  let idSeq = 100;
  const nextId = () => ++idSeq;
  const now = () => new Date();

  // Stores
  const conversations = new Map<number, AnyRecord>();
  const conversationByToken = new Map<string, AnyRecord>();
  const conversationMessages = new Map<number, AnyRecord>();
  const leads = new Map<number, AnyRecord>();
  const tickets = new Map<number, AnyRecord>();
  const feedbacks = new Map<number, AnyRecord>();
  const auditLogs = new Map<number, AnyRecord>();
  const knowledgeEntries = new Map<number, AnyRecord>();
  const knowledgeVersions = new Map<number, AnyRecord>();
  const knowledgeCategories = new Map<string, AnyRecord>([
    [
      'faq-general',
      {
        id: nextId(),
        key: 'faq-general',
        label: '常見問題',
        description: '一般 FAQ 類知識',
        defaultIntentLabel: 'general-faq',
        isActive: true,
        sortOrder: 10,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null,
      },
    ],
    [
      'product-spec',
      {
        id: nextId(),
        key: 'product-spec',
        label: '產品規格',
        description: '產品規格、尺寸、材質、型號等知識',
        defaultIntentLabel: 'product-inquiry',
        isActive: true,
        sortOrder: 20,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null,
      },
    ],
  ]);

  // ── conversation ──────────────────────────────────────────────────────────

  const conversation = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const token = randomUUID();
      const sid = randomUUID();
      const row: AnyRecord = {
        id,
        sessionId: sid,
        session_token: token,
        status: (data.status as string) ?? 'active',
        type: (data.type as string) ?? 'normal',
        language: (data.language as string) ?? 'zh-TW',
        riskLevel: null,
        sensitiveIntentCount: 0,
        highIntentScore: 0,
        diagnosisContext: null,
        createdAt: (data.createdAt as Date) ?? now(),
        updatedAt: now(),
        deletedAt: null,
      };
      conversations.set(id, row);
      conversationByToken.set(token, row);
      return Promise.resolve(row);
    },
    findUnique({
      where,
      include,
    }: {
      where: AnyRecord;
      include?: AnyRecord;
    }) {
      let row: AnyRecord | undefined;
      if (where.session_token !== undefined) {
        row = conversationByToken.get(where.session_token as string);
      } else if (where.id !== undefined) {
        row = conversations.get(where.id as number);
      }
      if (!row) return Promise.resolve(null);
      const result: AnyRecord = { ...row };
      if (include?._count) {
        const msgCount = Array.from(conversationMessages.values()).filter(
          (m) => m.conversationId === row!.id,
        ).length;
        result._count = { messages: msgCount };
      }
      if (include?.messages) {
        const msgs = Array.from(conversationMessages.values())
          .filter((m) => m.conversationId === row!.id)
          .sort(
            (a, b) =>
              (a.createdAt as Date).getTime() -
              (b.createdAt as Date).getTime(),
          );
        result.messages = msgs;
      }
      return Promise.resolve(result);
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(conversations.values()).find((r) =>
        matchesWhere(r, where),
      );
      return Promise.resolve(result ?? null);
    },
    findMany({
      where,
      include,
      skip,
      take,
    }: {
      where?: AnyRecord;
      include?: AnyRecord;
      skip?: number;
      take?: number;
    }) {
      let rows = Array.from(conversations.values()).filter((r) =>
        matchesWhere(r, where),
      );
      if (skip !== undefined) rows = rows.slice(skip);
      if (take !== undefined) rows = rows.slice(0, take);
      if (include) {
        rows = rows.map((r) => {
          const result: AnyRecord = { ...r };
          if (include._count) {
            const msgCount = Array.from(conversationMessages.values()).filter(
              (m) => m.conversationId === r.id,
            ).length;
            const fbCount = Array.from(feedbacks.values()).filter(
              (f) => f.conversationId === r.id,
            ).length;
            result._count = { messages: msgCount, feedbacks: fbCount };
          }
          if (include.messages) {
            const msgs = Array.from(conversationMessages.values())
              .filter((m) => m.conversationId === r.id)
              .sort(
                (a, b) =>
                  (b.createdAt as Date).getTime() -
                  (a.createdAt as Date).getTime(),
              )
              .slice(0, Number((include.messages as AnyRecord).take ?? 1))
              .map((m) => ({ content: m.content, createdAt: m.createdAt }));
            result.messages = msgs;
          }
          return result;
        });
      }
      return Promise.resolve(rows);
    },
    count({ where }: { where?: AnyRecord }) {
      return Promise.resolve(
        Array.from(conversations.values()).filter((r) =>
          matchesWhere(r, where),
        ).length,
      );
    },
    update({ where, data }: { where: AnyRecord; data: AnyRecord }) {
      const row = conversations.get(where.id as number);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data, { updatedAt: now() });
      return Promise.resolve(row);
    },
  };

  // ── conversationMessage ───────────────────────────────────────────────────

  const conversationMessage = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const row: AnyRecord = {
        id,
        conversationId: data.conversationId,
        role: data.role,
        content: data.content,
        type: (data.type as string) ?? 'text',
        riskLevel: null,
        blockedReason: null,
        createdAt: now(),
        updatedAt: now(),
      };
      conversationMessages.set(id, row);
      return Promise.resolve(row);
    },
    findUnique({ where }: { where: AnyRecord }) {
      return Promise.resolve(
        conversationMessages.get(where.id as number) ?? null,
      );
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
      if (orderBy?.createdAt === 'desc') rows = [...rows].reverse();
      if (take !== undefined) rows = rows.slice(0, take);
      return Promise.resolve(rows);
    },
  };

  // ── lead ──────────────────────────────────────────────────────────────────

  const lead = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const conversationId =
        (data.conversation as AnyRecord)?.connect !== undefined
          ? ((data.conversation as AnyRecord).connect as AnyRecord).id
          : (data.conversationId as number | undefined) ?? null;
      const row: AnyRecord = {
        id,
        conversationId: conversationId ?? null,
        name: data.name,
        email: data.email,
        company: data.company ?? null,
        phone: data.phone ?? null,
        message: data.message ?? null,
        language: (data.language as string) ?? null,
        type: (data.type as string) ?? 'general',
        riskLevel: null,
        status: (data.status as string) ?? 'new',
        notificationStatus: (data.notificationStatus as string) ?? 'pending',
        notes: null,
        confidentialityTriggered: false,
        promptInjectionDetected: false,
        sensitiveIntentCount: 0,
        highIntentScore: 0,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      leads.set(id, row);
      return Promise.resolve(row);
    },
    findUnique({
      where,
      include,
    }: {
      where: AnyRecord;
      include?: AnyRecord;
    }) {
      const row = leads.get(where.id as number);
      if (!row) return Promise.resolve(null);
      const result: AnyRecord = { ...row };
      if (include?.conversation) {
        const conv = row.conversationId
          ? conversations.get(row.conversationId as number)
          : null;
        result.conversation = conv
          ? {
              id: conv.id,
              sessionId: conv.sessionId,
              session_token: conv.session_token,
              status: conv.status,
              _count: {
                messages: Array.from(conversationMessages.values()).filter(
                  (m) => m.conversationId === conv.id,
                ).length,
              },
            }
          : null;
      }
      if (include?.tickets) {
        const ts = Array.from(tickets.values()).filter(
          (t) => t.leadId === row.id,
        );
        result.tickets = ts.map((t) => ({
          id: t.id,
          status: t.status,
          priority: t.priority,
          triggerReason: t.triggerReason,
          createdAt: t.createdAt,
        }));
      }
      return Promise.resolve(result);
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(leads.values()).find((r) =>
        matchesWhere(r, where),
      );
      return Promise.resolve(result ?? null);
    },
    findMany({
      where,
      include,
      skip,
      take,
    }: {
      where?: AnyRecord;
      include?: AnyRecord;
      skip?: number;
      take?: number;
    }) {
      let rows = Array.from(leads.values()).filter((r) =>
        matchesWhere(r, where),
      );
      if (skip !== undefined) rows = rows.slice(skip);
      if (take !== undefined) rows = rows.slice(0, take);
      if (include?.conversation) {
        rows = rows.map((r) => {
          const conv = r.conversationId
            ? conversations.get(r.conversationId as number)
            : null;
          return {
            ...r,
            conversation: conv
              ? {
                  session_token: conv.session_token,
                  sessionId: conv.sessionId,
                  status: conv.status,
                }
              : null,
          };
        });
      }
      if (include?.tickets) {
        rows = rows.map((r) => {
          const ts = Array.from(tickets.values())
            .filter((t) => t.leadId === r.id)
            .slice(0, 1);
          return { ...r, tickets: ts.map((t) => ({ id: t.id, status: t.status })) };
        });
      }
      return Promise.resolve(rows);
    },
    count({ where }: { where?: AnyRecord }) {
      return Promise.resolve(
        Array.from(leads.values()).filter((r) => matchesWhere(r, where)).length,
      );
    },
    update({
      where,
      data,
      include,
    }: {
      where: AnyRecord;
      data: AnyRecord;
      include?: AnyRecord;
    }) {
      const row = leads.get(where.id as number);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data, { updatedAt: now() });
      if (include?.conversation) {
        const conv = row.conversationId
          ? conversations.get(row.conversationId as number)
          : null;
        (row as AnyRecord).conversation = conv
          ? {
              session_token: conv.session_token,
              sessionId: conv.sessionId,
              status: conv.status,
            }
          : null;
      }
      if (include?.tickets) {
        const ts = Array.from(tickets.values())
          .filter((t) => t.leadId === row.id)
          .slice(0, 1);
        (row as AnyRecord).tickets = ts.map((t) => ({
          id: t.id,
          status: t.status,
        }));
      }
      return Promise.resolve({ ...row });
    },
  };

  // ── ticket ────────────────────────────────────────────────────────────────

  const ticket = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const conversationId =
        (data.conversation as AnyRecord)?.connect !== undefined
          ? ((data.conversation as AnyRecord).connect as AnyRecord).id
          : (data.conversationId as number | undefined) ?? null;
      const leadId =
        (data.lead as AnyRecord)?.connect !== undefined
          ? ((data.lead as AnyRecord).connect as AnyRecord).id
          : (data.leadId as number | null | undefined) ?? null;
      const row: AnyRecord = {
        id,
        conversationId: conversationId ?? null,
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
      const result: AnyRecord = { ...row };
      if (include?.lead) {
        const l = row.leadId ? leads.get(row.leadId as number) : null;
        result.lead = l
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
        const c = row.conversationId
          ? conversations.get(row.conversationId as number)
          : null;
        result.conversation = c
          ? { id: c.id, sessionId: c.sessionId, session_token: c.session_token }
          : null;
      }
      return Promise.resolve(result);
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(tickets.values()).find((r) =>
        matchesWhere(r, where),
      );
      return Promise.resolve(result ?? null);
    },
    findMany({
      where,
      include,
      skip,
      take,
    }: {
      where?: AnyRecord;
      include?: AnyRecord;
      skip?: number;
      take?: number;
    }) {
      let rows = Array.from(tickets.values()).filter((r) =>
        matchesWhere(r, where),
      );
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
      return Promise.resolve(
        Array.from(tickets.values()).filter((r) => matchesWhere(r, where)).length,
      );
    },
    update({ where, data }: { where: AnyRecord; data: AnyRecord }) {
      const row = tickets.get(where.id as number);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data, { updatedAt: now() });
      return Promise.resolve({ ...row });
    },
  };

  // ── feedback ──────────────────────────────────────────────────────────────

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
    findMany({
      where,
      include,
      skip,
      take,
    }: {
      where?: AnyRecord;
      include?: AnyRecord;
      skip?: number;
      take?: number;
    }) {
      let rows = Array.from(feedbacks.values()).filter((r) =>
        matchesWhere(r, where),
      );
      if (skip !== undefined) rows = rows.slice(skip);
      if (take !== undefined) rows = rows.slice(0, take);
      if (include?.conversation) {
        rows = rows.map((r) => {
          const conv = r.conversationId
            ? conversations.get(r.conversationId as number)
            : null;
          return {
            ...r,
            conversation: conv ? { session_token: conv.session_token } : null,
          };
        });
      }
      if (include?.message) {
        rows = rows.map((r) => {
          const msg = r.messageId
            ? conversationMessages.get(r.messageId as number)
            : null;
          return { ...r, message: msg ? { content: msg.content } : null };
        });
      }
      return Promise.resolve(rows);
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
        Array.from(feedbacks.values()).filter((r) => matchesWhere(r, where))
          .length,
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
      const field = by[0];
      const groups = new Map<unknown, number>();
      for (const row of rows) {
        const key = row[field];
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      const result = Array.from(groups.entries()).map(([value, count]) => ({
        [field]: value,
        _count: _count
          ? { [Object.keys(_count)[0]]: count }
          : { _all: count },
      }));
      return Promise.resolve(result);
    },
  };

  // ── auditLog — full store (admin queries need to read back seeded rows) ───

  const auditLog = {
    /** Fire-and-forget create — does NOT persist to the query store. */
    create() {
      return Promise.resolve({});
    },
    findMany({
      where,
      take,
      skip,
      orderBy,
    }: {
      where?: AnyRecord;
      take?: number;
      skip?: number;
      orderBy?: AnyRecord;
    }) {
      let rows = Array.from(auditLogs.values()).filter((r) =>
        matchesWhere(r, where),
      );
      if (orderBy?.createdAt === 'desc') rows = [...rows].reverse();
      if (skip !== undefined) rows = rows.slice(skip);
      if (take !== undefined) rows = rows.slice(0, take);
      return Promise.resolve(rows);
    },
    count({ where }: { where?: AnyRecord }) {
      return Promise.resolve(
        Array.from(auditLogs.values()).filter((r) => matchesWhere(r, where))
          .length,
      );
    },
    findUnique({ where }: { where: AnyRecord }) {
      return Promise.resolve(auditLogs.get(where.id as number) ?? null);
    },
    /** Test helper: insert a row into the query store and return its id. */
    _seed(data: AnyRecord): number {
      const id = nextId();
      auditLogs.set(id, {
        id,
        requestId: null,
        sessionId: null,
        eventType: 'chat_message',
        eventData: {},
        knowledgeRefs: [],
        ragConfidence: null,
        blockedReason: null,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        aiModel: null,
        aiProvider: null,
        promptHash: null,
        configSnapshot: {},
        createdAt: now(),
        ...data,
      });
      return id;
    },
  };

  // ── knowledgeEntry ────────────────────────────────────────────────────────

  const knowledgeEntry = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const row: AnyRecord = {
        id,
        title: data.title,
        content: data.content,
        intentLabel: data.intentLabel ?? null,
        tags: data.tags ?? [],
        aliases: data.aliases ?? [],
        language: (data.language as string) ?? 'zh-TW',
        status: (data.status as string) ?? 'draft',
        visibility: (data.visibility as string) ?? 'private',
        sourceKey: data.sourceKey ?? null,
        category: data.category ?? null,
        answerType: (data.answerType as string) ?? 'rag',
        templateKey: data.templateKey ?? null,
        faqQuestions: data.faqQuestions ?? [],
        crossLanguageGroupKey: data.crossLanguageGroupKey ?? null,
        structuredAttributes: data.structuredAttributes ?? null,
        version: (data.version as number) ?? 1,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null,
      };
      knowledgeEntries.set(id, row);
      return Promise.resolve(row);
    },
    findUnique({ where }: { where: AnyRecord }) {
      return Promise.resolve(
        knowledgeEntries.get(where.id as number) ?? null,
      );
    },
    findMany({
      where,
      skip,
      take,
    }: {
      where?: AnyRecord;
      skip?: number;
      take?: number;
    }) {
      let rows = Array.from(knowledgeEntries.values()).filter((r) =>
        matchesWhere(r, where),
      );
      if (skip !== undefined) rows = rows.slice(skip);
      if (take !== undefined) rows = rows.slice(0, take);
      return Promise.resolve(rows);
    },
    count({ where }: { where?: AnyRecord }) {
      return Promise.resolve(
        Array.from(knowledgeEntries.values()).filter((r) =>
          matchesWhere(r, where),
        ).length,
      );
    },
    update({ where, data }: { where: AnyRecord; data: AnyRecord }) {
      const row = knowledgeEntries.get(where.id as number);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data, { updatedAt: now() });
      return Promise.resolve({ ...row });
    },
  };

  // ── knowledgeVersion ──────────────────────────────────────────────────────

  const knowledgeVersion = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const row: AnyRecord = { id, ...data, createdAt: now() };
      knowledgeVersions.set(id, row);
      return Promise.resolve(row);
    },
  };

  // ── knowledgeCategory ────────────────────────────────────────────────────

  const knowledgeCategory = {
    findMany({ where, orderBy }: { where?: AnyRecord; orderBy?: AnyRecord[] } = {}) {
      let rows = Array.from(knowledgeCategories.values()).filter((r) =>
        matchesWhere(r, where),
      );
      if (Array.isArray(orderBy)) {
        rows = [...rows].sort((a, b) => {
          for (const order of orderBy) {
            const [[field, direction]] = Object.entries(order);
            const aValue = a[field] as string | number;
            const bValue = b[field] as string | number;
            if (aValue === bValue) continue;
            const result = aValue > bValue ? 1 : -1;
            return direction === 'desc' ? -result : result;
          }
          return 0;
        });
      }
      return Promise.resolve(rows);
    },
    findUnique({ where }: { where: AnyRecord }) {
      return Promise.resolve(knowledgeCategories.get(where.key as string) ?? null);
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(knowledgeCategories.values()).find((r) =>
        matchesWhere(r, where),
      );
      return Promise.resolve(result ?? null);
    },
    create({ data }: { data: AnyRecord }) {
      if (knowledgeCategories.has(data.key as string)) {
        return Promise.reject(new Error('Unique constraint failed'));
      }
      const row: AnyRecord = {
        id: nextId(),
        key: data.key,
        label: data.label,
        description: data.description ?? null,
        defaultIntentLabel: data.defaultIntentLabel ?? null,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null,
      };
      knowledgeCategories.set(row.key as string, row);
      return Promise.resolve(row);
    },
    update({ where, data }: { where: AnyRecord; data: AnyRecord }) {
      const row = knowledgeCategories.get(where.key as string);
      if (!row) return Promise.reject(new Error('Record not found'));
      Object.assign(row, data, { updatedAt: now() });
      return Promise.resolve({ ...row });
    },
  };

  return {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    /** Handles interactive-transaction array pattern used by updateWithVersionSnapshot. */
    $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
    // Static mocks for module initialization
    systemConfig: {
      findMany: jest.fn().mockResolvedValue([
        { key: 'widget_status', value: 'online' },
        {
          key: 'widget_welcome_message',
          value: JSON.stringify({ 'zh-TW': '歡迎使用客服', en: 'Welcome' }),
        },
        {
          key: 'widget_quick_replies',
          value: JSON.stringify({ 'zh-TW': ['產品規格'], en: ['Product specs'] }),
        },
        {
          key: 'widget_disclaimer',
          value: JSON.stringify({ 'zh-TW': '本服務由 AI 提供', en: 'AI assisted' }),
        },
        {
          key: 'widget_fallback_message',
          value: JSON.stringify({ 'zh-TW': '請稍後再試', en: 'Please try again later' }),
        },
      ]),
    },
    safetyRule: { findMany: jest.fn().mockResolvedValue([]) },
    blacklistEntry: { findMany: jest.fn().mockResolvedValue([]) },
    intentTemplate: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 1,
          title: 'product-inquiry',
          label: '產品詢問',
          keywords: ['產品'],
          templateZh: '',
          templateEn: '',
          priority: 10,
          isActive: true,
          category: 'product-spec',
          createdAt: now(),
          updatedAt: now(),
        },
        {
          id: 2,
          title: 'general-faq',
          label: '常見問題',
          keywords: ['FAQ'],
          templateZh: '',
          templateEn: '',
          priority: 0,
          isActive: true,
          category: 'faq-general',
          createdAt: now(),
          updatedAt: now(),
        },
      ]),
    },
    glossaryTerm: { findMany: jest.fn().mockResolvedValue([]) },
    // Stateful stores
    conversation,
    conversationMessage,
    lead,
    ticket,
    feedback,
    auditLog,
    knowledgeEntry,
    knowledgeVersion,
    knowledgeCategory,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Admin API query endpoint checkpoint (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: ReturnType<typeof buildAdminMock>;

  // IDs captured during seed phase
  let convId: number;
  let convSessionId: string;
  let msgId: number;
  let leadId: number;
  let ticketId: number;
  let feedbackId: number;
  let auditLogId: number;

  beforeAll(async () => {
    mockPrisma = buildAdminMock();

    // ── Seed test data ────────────────────────────────────────────────────

    // Conversation + message
    const conv = await (
      mockPrisma.conversation.create as (args: { data: AnyRecord }) => Promise<AnyRecord>
    )({ data: { language: 'zh-TW', type: 'normal' } });
    convId = conv.id as number;
    convSessionId = conv.sessionId as string;

    const msg = await (
      mockPrisma.conversationMessage.create as (args: { data: AnyRecord }) => Promise<AnyRecord>
    )({ data: { conversationId: convId, role: 'user', content: 'Hello admin test' } });
    msgId = msg.id as number;

    // Lead linked to conversation
    const ld = await (
      mockPrisma.lead.create as (args: { data: AnyRecord }) => Promise<AnyRecord>
    )({ data: { conversationId: convId, name: 'Alice Test', email: 'alice@example.com', type: 'general' } });
    leadId = ld.id as number;

    // Ticket linked to conversation + lead
    const tk = await (
      mockPrisma.ticket.create as (args: { data: AnyRecord }) => Promise<AnyRecord>
    )({ data: { conversationId: convId, leadId, status: 'open', priority: 'normal', triggerReason: 'test handoff' } });
    ticketId = tk.id as number;

    // Feedback on the message
    const fb = await (
      mockPrisma.feedback.create as (args: { data: AnyRecord }) => Promise<AnyRecord>
    )({ data: { conversationId: convId, messageId: msgId, value: 'up', reason: null } });
    feedbackId = fb.id as number;

    // Audit log row (seeded directly into the query store)
    auditLogId = (mockPrisma.auditLog as ReturnType<typeof buildAdminMock>['auditLog'])._seed({
      requestId: 'req-e2e-001',
      sessionId: convSessionId,
      eventType: 'chat_message',
      eventData: { message: 'test' },
      knowledgeRefs: [],
      ragConfidence: 0.92,
      blockedReason: null,
      promptTokens: 15,
      completionTokens: 30,
      totalTokens: 45,
      durationMs: 220,
      aiModel: 'gpt-4o-mini',
      aiProvider: 'openai',
      promptHash: 'abc123',
      configSnapshot: { model: 'gpt-4o-mini' },
    });

    // ── Build app ─────────────────────────────────────────────────────────

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── 1. Dashboard ──────────────────────────────────────────────────────────

  describe('Dashboard (GET /admin/dashboard)', () => {
    it('returns 200 with expected stats shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard')
        .expect(200);

      expect(res.body).toHaveProperty('data');
      const data = res.body.data as AnyRecord;
      expect(typeof data.todayConversations).toBe('number');
      expect(typeof data.monthlyConversations).toBe('number');
      expect(typeof data.aiResolutionRate).toBe('number');
      expect(typeof data.pendingTickets).toBe('number');
      expect(typeof data.monthlyLeads).toBe('number');
      expect(Array.isArray(data.latestAuditEvents)).toBe(true);
      expect(Array.isArray(data.conversationTrend)).toBe(true);
    });

    it('accepts a valid month parameter', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard?month=2026-01')
        .expect(200);
    });

    it('returns 400 for invalid month format', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard?month=2026-1')
        .expect(400);
    });

    it('returns 400 for another invalid month format', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard?month=invalid')
        .expect(400);
    });
  });

  // ── 2. Conversations ──────────────────────────────────────────────────────

  describe('Conversations admin (GET /admin/conversations)', () => {
    it('returns paginated list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/conversations')
        .expect(200);

      expect(res.body.data).toHaveProperty('data');
      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect(res.body.data).toHaveProperty('meta');
      const meta = res.body.data.meta as AnyRecord;
      expect(typeof meta.total).toBe('number');
      expect(meta.page).toBe(1);
    });

    it('filters by language', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/conversations?language=zh-TW')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
    });

    it('filters by type', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/conversations?type=normal')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
    });

    it('returns conversation detail with messages + auditEvents + feedbackSummary', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/conversations/${convId}`)
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(convId);
      expect(Array.isArray(data.messages)).toBe(true);
      expect(Array.isArray(data.auditEvents)).toBe(true);
      expect(data).toHaveProperty('feedbackSummary');
      expect(typeof (data.feedbackSummary as AnyRecord).totalCount).toBe('number');
    });

    it('returns 404 for unknown conversation id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/conversations/99999')
        .expect(404);
    });
  });

  // ── 3. Audit Logs ─────────────────────────────────────────────────────────

  describe('Audit logs admin (GET /admin/audit-logs)', () => {
    it('returns paginated list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect(typeof res.body.data.meta.total).toBe('number');
    });

    it('filters by exact requestId', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs?requestId=req-e2e-001')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect((res.body.data.data as AnyRecord[]).length).toBeGreaterThanOrEqual(1);
      expect((res.body.data.data as AnyRecord[])[0].requestId).toBe('req-e2e-001');
    });

    it('filters by eventType substring', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs?eventType=chat')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
    });

    it('returns audit log detail with token fields', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/audit-logs/${auditLogId}`)
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(auditLogId);
      expect(data.eventType).toBe('chat_message');
      expect(typeof data.promptTokens).toBe('number');
      expect(typeof data.completionTokens).toBe('number');
      expect(typeof data.totalTokens).toBe('number');
      expect(typeof data.durationMs).toBe('number');
      expect(data.aiModel).toBe('gpt-4o-mini');
    });

    it('returns 404 for unknown audit log id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs/99999')
        .expect(404);
    });
  });

  // ── 4. Leads ──────────────────────────────────────────────────────────────

  describe('Leads admin (/admin/leads)', () => {
    it('GET /admin/leads → 200 paginated list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/leads')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect(typeof res.body.data.meta.total).toBe('number');
      const firstLead = (res.body.data.data as AnyRecord[])[0];
      expect(firstLead.id).toBe(leadId);
      expect(firstLead.email).toBe('alice@example.com');
    });

    it('GET /admin/leads?status=new → filters by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/leads?status=new')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect((res.body.data.data as AnyRecord[]).length).toBeGreaterThanOrEqual(1);
    });

    it('GET /admin/leads?status=invalid → 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/leads?status=invalid')
        .expect(400);
    });

    it('GET /admin/leads/:id → returns lead detail', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/leads/${leadId}`)
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(leadId);
      expect(data.name).toBe('Alice Test');
      expect(data.email).toBe('alice@example.com');
    });

    it('GET /admin/leads/:id → 404 for unknown id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/leads/99999')
        .expect(404);
    });

    it('PATCH /admin/leads/:id → updates lead fields', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/leads/${leadId}`)
        .send({ company: 'Acme Corp' })
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(leadId);
    });

    it('PATCH /admin/leads/:id/status → updates status to contacted', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/leads/${leadId}/status`)
        .send({ status: 'contacted' })
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(leadId);
    });

    it('PATCH /admin/leads/:id/status with invalid status → 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/leads/${leadId}/status`)
        .send({ status: 'invalid-status' })
        .expect(400);
    });
  });

  // ── 5. Tickets ────────────────────────────────────────────────────────────

  describe('Tickets admin (/admin/tickets)', () => {
    it('GET /admin/tickets → 200 paginated list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/tickets')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect(typeof res.body.data.meta.total).toBe('number');
    });

    it('GET /admin/tickets?status=open → filters by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/tickets?status=open')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect((res.body.data.data as AnyRecord[]).length).toBeGreaterThanOrEqual(1);
    });

    it('GET /admin/tickets?status=invalid → 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/tickets?status=invalid')
        .expect(400);
    });

    it('GET /admin/tickets/:id → returns ticket detail with timeline', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/tickets/${ticketId}`)
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(ticketId);
      expect(data.status).toBe('open');
      expect(Array.isArray(data.timeline)).toBe(true);
    });

    it('GET /admin/tickets/:id → 404 for unknown id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/tickets/99999')
        .expect(404);
    });

    it('PATCH /admin/tickets/:id/status → updates status to in_progress', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/tickets/${ticketId}/status`)
        .send({ status: 'in_progress' })
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(ticketId);
      expect(data.status).toBe('in_progress');
    });

    it('PATCH /admin/tickets/:id/status with invalid status → 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/tickets/${ticketId}/status`)
        .send({ status: 'unknown' })
        .expect(400);
    });

    it('POST /admin/tickets/:id/notes → appends a note', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/tickets/${ticketId}/notes`)
        .send({ content: 'This is a test note' })
        .expect(201);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(ticketId);
      const notes = data.notes as AnyRecord[];
      expect(Array.isArray(notes)).toBe(true);
      expect(notes.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /admin/tickets/:id/notes with blank content → 400', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/tickets/${ticketId}/notes`)
        .send({ content: '   ' })
        .expect(400);
    });
  });

  // ── 6. Feedback ───────────────────────────────────────────────────────────

  describe('Feedback admin (GET /admin/feedback)', () => {
    it('returns paginated list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/feedback')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect(typeof res.body.data.meta.total).toBe('number');
      expect((res.body.data.data as AnyRecord[]).length).toBeGreaterThanOrEqual(1);
    });

    it('filters by value=up', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/feedback?value=up')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect((res.body.data.data as AnyRecord[]).length).toBeGreaterThanOrEqual(1);
    });

    it('filters by conversationId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/feedback?conversationId=${convId}`)
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect((res.body.data.data as AnyRecord[]).length).toBeGreaterThanOrEqual(1);
    });

    it('filters by messageId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/feedback?messageId=${msgId}`)
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
    });

    it('returns 400 for invalid value filter', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/feedback?value=neutral')
        .expect(400);
    });
  });

  // ── 7. Knowledge ──────────────────────────────────────────────────────────

  describe('Knowledge admin (/admin/knowledge)', () => {
    let knowledgeId: number;

    it('GET /admin/knowledge/categories → returns active category options', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge/categories')
        .expect(200);

      const data = res.body.data as AnyRecord[];
      const productSpec = data.find((option) => option.value === 'product-spec');
      expect(productSpec).toEqual(
        expect.objectContaining({
          label: '產品規格',
          value: 'product-spec',
          defaultIntentLabel: 'product-inquiry',
        }),
      );
    });

    it('GET /admin/knowledge/filters → returns category options from knowledge categories', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge/filters')
        .expect(200);

      const data = res.body.data as AnyRecord;
      const categories = data.category as AnyRecord[];
      const productSpec = categories.find((option) => option.value === 'product-spec');
      expect(productSpec).toEqual(
        expect.objectContaining({
          label: '產品規格',
          value: 'product-spec',
          description: '產品規格、尺寸、材質、型號等知識',
          defaultIntentLabel: 'product-inquiry',
        }),
      );
    });

    it('POST /admin/knowledge/categories → creates a category', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge/categories')
        .send({
          key: 'pricing-info',
          label: '報價資訊',
          description: '報價、詢價、價格規則相關知識',
          defaultIntentLabel: 'product-inquiry',
          sortOrder: 40,
        })
        .expect(201);

      const data = res.body.data as AnyRecord;
      expect(data).toEqual(
        expect.objectContaining({
          key: 'pricing-info',
          label: '報價資訊',
          defaultIntentLabel: 'product-inquiry',
          isActive: true,
          sortOrder: 40,
        }),
      );
    });

    it('PATCH /admin/knowledge/categories/:key → updates category settings', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/admin/knowledge/categories/pricing-info')
        .send({
          label: '價格資訊',
          defaultIntentLabel: 'general-faq',
          isActive: true,
          sortOrder: 45,
        })
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data).toEqual(
        expect.objectContaining({
          key: 'pricing-info',
          label: '價格資訊',
          defaultIntentLabel: 'general-faq',
          sortOrder: 45,
        }),
      );
    });

    it('POST/PATCH /admin/knowledge/categories reject unknown defaultIntentLabel', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge/categories')
        .send({
          key: 'invalid-default',
          label: 'Invalid',
          defaultIntentLabel: 'missing-intent',
        })
        .expect(400);

      await request(app.getHttpServer())
        .patch('/api/v1/admin/knowledge/categories/pricing-info')
        .send({ defaultIntentLabel: 'missing-intent' })
        .expect(400);
    });

    it('DELETE /admin/knowledge/categories/:key → soft deletes category', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/v1/admin/knowledge/categories/pricing-info')
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.isActive).toBe(false);
      expect(data.deletedAt).toBeTruthy();
    });

    it('POST /admin/knowledge → creates entry with status=draft and version=1', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge')
        .send({
          title: 'Test Entry',
          content: 'Test content for e2e',
          language: 'zh-TW',
          visibility: 'public',
        })
        .expect(201);

      const data = res.body.data as AnyRecord;
      expect(data.status).toBe('draft');
      expect(data.version).toBe(1);
      expect(data.title).toBe('Test Entry');
      knowledgeId = data.id as number;
    });

    it('GET /admin/knowledge → lists entries', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge')
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect(typeof res.body.data.meta.total).toBe('number');
    });

    it('GET /admin/knowledge/:id → returns single entry', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/knowledge/${knowledgeId}`)
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(knowledgeId);
    });

    it('PATCH /admin/knowledge/:id → updates content and increments version', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/knowledge/${knowledgeId}`)
        .send({ content: 'Updated content', title: 'Updated Title' })
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(knowledgeId);
      expect(data.version).toBe(2);
      expect(data.status).toBe('draft');
    });

    it('PATCH /admin/knowledge/:id/visibility → updates visibility only', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/knowledge/${knowledgeId}/visibility`)
        .send({ visibility: 'public' })
        .expect(200);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(knowledgeId);
      expect(data.visibility).toBe('public');
      expect(data).toHaveProperty('retrievable');
      expect(data).toHaveProperty('retrievalBlockReasons');
      expect(data.version).toBe(2);
      expect(data.status).toBe('draft');
    });

    it('POST /admin/knowledge/:id/publish → sets status to published', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge/${knowledgeId}/publish`)
        .expect(201);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(knowledgeId);
      expect(data.status).toBe('published');
    });

    it('POST /admin/knowledge/:id/archive → sets status to archived', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge/${knowledgeId}/archive`)
        .expect(201);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(knowledgeId);
      expect(data.status).toBe('archived');
    });

    it('POST /admin/knowledge/:id/publish when archived → restores published', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge/${knowledgeId}/publish`)
        .expect(201);

      const data = res.body.data as AnyRecord;
      expect(data.id).toBe(knowledgeId);
      expect(data.status).toBe('published');
    });

    it('GET /admin/knowledge/:id → 404 for unknown id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge/99999')
        .expect(404);
    });

    it('POST /admin/knowledge with missing required fields → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge')
        .send({ language: 'zh-TW' })
        .expect(400);
    });
  });

  // ── 8. Regression guard — public chat/widget APIs ─────────────────────────

  describe('Regression guard — public API endpoints', () => {
    it('POST /chat/sessions → creates session (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .expect(201);

      expect(res.body.data).toHaveProperty('sessionToken');
      expect(typeof res.body.data.sessionToken).toBe('string');
    });

    it('GET /widget/config → returns config with status field (200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/widget/config')
        .expect(200);

      expect(res.body.data).toHaveProperty('status');
    });
  });

  // ── Cross-resource isolation ──────────────────────────────────────────────

  describe('Cross-resource isolation', () => {
    it('dashboard counts reflect seeded data (total ≥ 0)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard')
        .expect(200);

      const data = res.body.data as AnyRecord;
      // Counts may vary depending on date ranges, but should never be negative
      expect(data.todayConversations).toBeGreaterThanOrEqual(0);
      expect(data.monthlyLeads).toBeGreaterThanOrEqual(0);
    });

    it('feedback and conversation IDs are consistent across admin modules', async () => {
      const feedbackRes = await request(app.getHttpServer())
        .get(`/api/v1/admin/feedback?conversationId=${convId}`)
        .expect(200);

      const items = feedbackRes.body.data.data as AnyRecord[];
      expect(items.every((f) => f.conversationId === convId)).toBe(true);

      const convRes = await request(app.getHttpServer())
        .get(`/api/v1/admin/conversations/${convId}`)
        .expect(200);

      expect(convRes.body.data.id).toBe(convId);
    });

    it('conversation detail includes the seeded message', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/conversations/${convId}`)
        .expect(200);

      const msgs = (res.body.data as AnyRecord).messages as AnyRecord[];
      expect(msgs.some((m) => m.id === msgId)).toBe(true);
    });
  });
});
