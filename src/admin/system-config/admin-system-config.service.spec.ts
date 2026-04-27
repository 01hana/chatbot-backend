import { NotFoundException } from '@nestjs/common';
import { AdminSystemConfigService } from './admin-system-config.service';

const now = new Date();

function makeEntry(key: string, value: string, description?: string) {
  return { key, value, description: description ?? null, updatedAt: now };
}

function makePrismaMock(entries: ReturnType<typeof makeEntry>[]) {
  return {
    systemConfig: {
      findMany: jest.fn().mockResolvedValue(entries),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) =>
        Promise.resolve(entries.find(e => e.key === where.key) ?? null),
      ),
      upsert: jest.fn().mockImplementation(
        ({ where, update, create }: {
          where: { key: string };
          update: { value: string; description?: string };
          create: { key: string; value: string; description?: string };
        }) => {
          const existing = entries.find(e => e.key === where.key);
          if (existing) {
            existing.value = update.value;
            if (update.description !== undefined) existing.description = update.description ?? null;
            return Promise.resolve(existing);
          }
          const created = makeEntry(create.key, create.value, create.description);
          entries.push(created);
          return Promise.resolve(created);
        },
      ),
    },
  };
}

function makeSystemConfigMock() {
  return {
    invalidateCache: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AdminSystemConfigService', () => {
  // ── listAll ──────────────────────────────────────────────────────────────

  describe('listAll()', () => {
    it('returns all system config entries ordered by key', async () => {
      const entries = [
        makeEntry('rag_confidence_threshold', '0.6', 'Min similarity score'),
        makeEntry('rate_limit_per_ip_per_min', '60', 'Max requests per IP'),
      ];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      const result = await service.listAll();

      expect(result).toHaveLength(2);
      expect(prisma.systemConfig.findMany).toHaveBeenCalledWith({ orderBy: { key: 'asc' } });
    });

    it('returns empty array when no entries exist', async () => {
      const prisma = makePrismaMock([]);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      const result = await service.listAll();
      expect(result).toEqual([]);
    });
  });

  // ── getOne ───────────────────────────────────────────────────────────────

  describe('getOne()', () => {
    it('returns the matching entry when the key exists', async () => {
      const entries = [makeEntry('rag_confidence_threshold', '0.6')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      const result = await service.getOne('rag_confidence_threshold');
      expect(result.key).toBe('rag_confidence_threshold');
      expect(result.value).toBe('0.6');
    });

    it('throws NotFoundException when the key does not exist', async () => {
      const prisma = makePrismaMock([]);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      await expect(service.getOne('nonexistent_key')).rejects.toThrow(NotFoundException);
    });

    it('includes the correct key in the error message', async () => {
      const prisma = makePrismaMock([]);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      await expect(service.getOne('missing_key')).rejects.toThrow("SystemConfig key 'missing_key' not found");
    });
  });

  // ── update / upsert ──────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates value of an existing entry and returns the updated entry', async () => {
      const entries = [makeEntry('rag_confidence_threshold', '0.6')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      const result = await service.update('rag_confidence_threshold', { value: '0.75' });
      expect(result.value).toBe('0.75');
    });

    it('creates a new entry when the key does not exist (upsert behaviour)', async () => {
      const entries: ReturnType<typeof makeEntry>[] = [];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      const result = await service.update('feature.query_analysis_enabled', { value: 'true' });
      expect(result.key).toBe('feature.query_analysis_enabled');
      expect(result.value).toBe('true');
    });

    it('updates description when supplied', async () => {
      const entries = [makeEntry('llm_timeout_ms', '10000', 'Old description')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      const result = await service.update('llm_timeout_ms', {
        value: '15000',
        description: 'Updated description',
      });
      expect(result.value).toBe('15000');
    });

    it('calls SystemConfigService.invalidateCache() after every write', async () => {
      const entries = [makeEntry('rag_confidence_threshold', '0.6')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      await service.update('rag_confidence_threshold', { value: '0.8' });

      expect(systemConfig.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache is called even when creating a new key', async () => {
      const entries: ReturnType<typeof makeEntry>[] = [];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      await service.update('brand_new_key', { value: 'some_value' });

      expect(systemConfig.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('passes correct upsert shape to Prisma', async () => {
      const entries = [makeEntry('widget_status', 'online')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never);

      await service.update('widget_status', { value: 'offline', description: 'Maintenance' });

      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'widget_status' },
          update: expect.objectContaining({ value: 'offline' }),
          create: expect.objectContaining({ key: 'widget_status', value: 'offline' }),
        }),
      );
    });
  });
});
