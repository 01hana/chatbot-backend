import { NotFoundException } from '@nestjs/common';
import { AdminIntentService } from './admin-intent.service';

const now = new Date();

function makeTemplate(id: number, intent: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    intent,
    label: `Label for ${intent}`,
    keywords: ['keyword1', 'keyword2'],
    templateZh: '請問您想了解的是？',
    templateEn: 'What would you like to know?',
    priority: 0,
    isActive: true,
    category: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePrismaMock(templates: ReturnType<typeof makeTemplate>[]) {
  return {
    intentTemplate: {
      findMany: jest.fn().mockResolvedValue(templates),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: number } }) =>
        Promise.resolve(templates.find(t => t.id === where.id) ?? null),
      ),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const created = makeTemplate(templates.length + 1, data['intent'] as string, data);
        templates.push(created);
        return Promise.resolve(created);
      }),
      update: jest.fn().mockImplementation(
        ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
          const entry = templates.find(t => t.id === where.id);
          if (!entry) return Promise.resolve(null);
          Object.assign(entry, data);
          return Promise.resolve(entry);
        },
      ),
    },
  };
}

function makeIntentServiceMock() {
  return { invalidateCache: jest.fn().mockResolvedValue(undefined) };
}

describe('AdminIntentService', () => {
  // ── listAll ──────────────────────────────────────────────────────────────

  describe('listAll()', () => {
    it('returns all templates with the expected orderBy shape', async () => {
      const templates = [makeTemplate(1, 'product-inquiry'), makeTemplate(2, 'pricing-inquiry')];
      const prisma = makePrismaMock(templates);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      const result = await service.listAll();

      expect(result).toHaveLength(2);
      expect(prisma.intentTemplate.findMany).toHaveBeenCalledWith({
        orderBy: [{ priority: 'desc' }, { id: 'asc' }],
      });
    });

    it('returns empty array when no templates exist', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      expect(await service.listAll()).toEqual([]);
    });
  });

  // ── getOne ───────────────────────────────────────────────────────────────

  describe('getOne()', () => {
    it('returns the matching template when it exists', async () => {
      const templates = [makeTemplate(1, 'product-inquiry')];
      const prisma = makePrismaMock(templates);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      const result = await service.getOne(1);
      expect(result.intent).toBe('product-inquiry');
    });

    it('throws NotFoundException when template does not exist', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      await expect(service.getOne(99)).rejects.toThrow(NotFoundException);
    });

    it('includes the id in the NotFoundException message', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      await expect(service.getOne(42)).rejects.toThrow('IntentTemplate #42 not found');
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a template and returns the new entry', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      const result = await service.create({
        intent: 'contact-inquiry',
        label: 'Contact Inquiry',
        keywords: ['聯絡', 'contact'],
        templateZh: '請提供您的聯絡資訊',
        templateEn: 'Please provide your contact details',
        priority: 5,
        category: 'contact',
      });

      expect(result.intent).toBe('contact-inquiry');
      expect(prisma.intentTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            intent: 'contact-inquiry',
            isActive: true,
            priority: 5,
          }),
        }),
      );
    });

    it('calls intentService.invalidateCache() after creating a template', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      await service.create({
        intent: 'general-faq',
        label: 'General FAQ',
        keywords: ['問題'],
        templateZh: '請問您的問題是？',
        templateEn: 'What is your question?',
      });

      expect(intentService.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('defaults priority to 0 when not provided', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      await service.create({
        intent: 'general-faq',
        label: 'General FAQ',
        keywords: ['問題'],
        templateZh: '請問您的問題是？',
        templateEn: 'What is your question?',
      });

      expect(prisma.intentTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ priority: 0 }) }),
      );
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates only the provided fields', async () => {
      const templates = [makeTemplate(1, 'product-inquiry')];
      const prisma = makePrismaMock(templates);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      const result = await service.update(1, { label: 'Updated Label' });
      expect(result.label).toBe('Updated Label');
    });

    it('calls intentService.invalidateCache() after updating', async () => {
      const templates = [makeTemplate(1, 'product-inquiry')];
      const prisma = makePrismaMock(templates);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      await service.update(1, { priority: 10 });
      expect(intentService.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when template does not exist', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      await expect(service.update(99, { label: 'New Label' })).rejects.toThrow(NotFoundException);
    });
  });

  // ── disable ──────────────────────────────────────────────────────────────

  describe('disable()', () => {
    it('sets isActive=false on the target template', async () => {
      const templates = [makeTemplate(1, 'product-inquiry', { isActive: true })];
      const prisma = makePrismaMock(templates);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      await service.disable(1);

      expect(prisma.intentTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 }, data: { isActive: false } }),
      );
    });

    it('calls intentService.invalidateCache() after disabling', async () => {
      const templates = [makeTemplate(1, 'product-inquiry')];
      const prisma = makePrismaMock(templates);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      await service.disable(1);
      expect(intentService.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when template does not exist', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      await expect(service.disable(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ── invalidateCacheManual ─────────────────────────────────────────────────

  describe('invalidateCacheManual()', () => {
    it('delegates directly to intentService.invalidateCache()', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminIntentService(prisma as never, intentService as never);

      await service.invalidateCacheManual();
      expect(intentService.invalidateCache).toHaveBeenCalledTimes(1);
    });
  });
});
