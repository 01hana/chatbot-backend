import { NotFoundException } from '@nestjs/common';
import { AdminGlossaryService } from './admin-glossary.service';

const now = new Date();

function makeTerm(id: number, term: string, synonyms: string[] = [], intentLabel?: string) {
  return { id, term, synonyms, intentLabel: intentLabel ?? null, createdAt: now };
}

function makePrismaMock(terms: ReturnType<typeof makeTerm>[]) {
  return {
    glossaryTerm: {
      findMany: jest.fn().mockResolvedValue(terms),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: number } }) =>
        Promise.resolve(terms.find(t => t.id === where.id) ?? null),
      ),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const created = makeTerm(
          terms.length + 1,
          data['term'] as string,
          (data['synonyms'] as string[]) ?? [],
          data['intentLabel'] as string | undefined,
        );
        terms.push(created);
        return Promise.resolve(created);
      }),
      update: jest.fn().mockImplementation(
        ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
          const entry = terms.find(t => t.id === where.id);
          if (!entry) return Promise.resolve(null);
          Object.assign(entry, data);
          return Promise.resolve(entry);
        },
      ),
      delete: jest.fn().mockImplementation(({ where }: { where: { id: number } }) => {
        const idx = terms.findIndex(t => t.id === where.id);
        if (idx !== -1) terms.splice(idx, 1);
        return Promise.resolve(undefined);
      }),
    },
  };
}

function makeIntentServiceMock() {
  return { invalidateCache: jest.fn().mockResolvedValue(undefined) };
}

describe('AdminGlossaryService', () => {
  // ── listAll ──────────────────────────────────────────────────────────────

  describe('listAll()', () => {
    it('returns all glossary terms ordered by id', async () => {
      const terms = [makeTerm(1, '螺絲', ['screw', '螺釘']), makeTerm(2, '螺帽', ['nut'])];
      const prisma = makePrismaMock(terms);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      const result = await service.listAll();

      expect(result).toHaveLength(2);
      expect(prisma.glossaryTerm.findMany).toHaveBeenCalledWith({ orderBy: { id: 'asc' } });
    });

    it('returns empty array when no terms exist', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      expect(await service.listAll()).toEqual([]);
    });
  });

  // ── getOne ───────────────────────────────────────────────────────────────

  describe('getOne()', () => {
    it('returns the matching term when it exists', async () => {
      const terms = [makeTerm(1, '螺絲', ['screw'])];
      const prisma = makePrismaMock(terms);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      const result = await service.getOne(1);
      expect(result.term).toBe('螺絲');
    });

    it('throws NotFoundException when term does not exist', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      await expect(service.getOne(99)).rejects.toThrow(NotFoundException);
    });

    it('includes the id in the NotFoundException message', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      await expect(service.getOne(42)).rejects.toThrow('GlossaryTerm #42 not found');
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a glossary term and returns the new entry', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      const result = await service.create({
        term: '墊片',
        synonyms: ['washer', 'gasket'],
        intentLabel: 'product-inquiry',
      });

      expect(result.term).toBe('墊片');
      expect(prisma.glossaryTerm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            term: '墊片',
            synonyms: ['washer', 'gasket'],
            intentLabel: 'product-inquiry',
          }),
        }),
      );
    });

    it('calls intentService.invalidateCache() after creating a term', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      await service.create({ term: '螺栓', synonyms: ['bolt'] });
      expect(intentService.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('sets intentLabel to null when not provided', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      await service.create({ term: '螺栓', synonyms: ['bolt'] });
      expect(prisma.glossaryTerm.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ intentLabel: null }) }),
      );
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates synonyms and returns the updated entry', async () => {
      const terms = [makeTerm(1, '螺絲', ['screw'])];
      const prisma = makePrismaMock(terms);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      const result = await service.update(1, { synonyms: ['screw', '螺釘', 'bolt'] });
      expect(result.synonyms).toEqual(['screw', '螺釘', 'bolt']);
    });

    it('calls intentService.invalidateCache() after updating', async () => {
      const terms = [makeTerm(1, '螺絲', ['screw'])];
      const prisma = makePrismaMock(terms);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      await service.update(1, { intentLabel: 'product-inquiry' });
      expect(intentService.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when term does not exist', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      await expect(service.update(99, { synonyms: ['bolt'] })).rejects.toThrow(NotFoundException);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('deletes the term from the database', async () => {
      const terms = [makeTerm(1, '螺絲', ['screw'])];
      const prisma = makePrismaMock(terms);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      await service.remove(1);
      expect(prisma.glossaryTerm.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('calls intentService.invalidateCache() after deletion', async () => {
      const terms = [makeTerm(1, '螺絲', ['screw'])];
      const prisma = makePrismaMock(terms);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      await service.remove(1);
      expect(intentService.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when term does not exist', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ── invalidateCacheManual ─────────────────────────────────────────────────

  describe('invalidateCacheManual()', () => {
    it('delegates directly to intentService.invalidateCache()', async () => {
      const prisma = makePrismaMock([]);
      const intentService = makeIntentServiceMock();
      const service = new AdminGlossaryService(prisma as never, intentService as never);

      await service.invalidateCacheManual();
      expect(intentService.invalidateCache).toHaveBeenCalledTimes(1);
    });
  });
});
