import { NotFoundException } from '@nestjs/common';
import { AdminSystemConfigService } from './admin-system-config.service';

const now = new Date();

function makeEntry(key: string, value: string, description?: string) {
  return { key, value, description: description ?? null, updatedAt: now };
}

type Entry = ReturnType<typeof makeEntry>;

function makePrismaMock(entries: Entry[]) {
  return {
    systemConfig: {
      findMany: jest.fn().mockResolvedValue(entries),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) =>
        Promise.resolve(entries.find(e => e.key === where.key) ?? null),
      ),
      update: jest.fn().mockImplementation(
        ({ where, data }: { where: { key: string }; data: { value: string; description?: string } }) => {
          const existing = entries.find(e => e.key === where.key);
          if (!existing) return Promise.resolve(null);
          existing.value = data.value;
          if (data.description !== undefined) existing.description = data.description ?? null;
          return Promise.resolve({ ...existing });
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

function makeAuditServiceMock() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
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
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      const result = await service.listAll();

      expect(result).toHaveLength(2);
      expect(prisma.systemConfig.findMany).toHaveBeenCalledWith({ orderBy: { key: 'asc' } });
    });

    it('returns empty array when no entries exist', async () => {
      const prisma = makePrismaMock([]);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

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
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      const result = await service.getOne('rag_confidence_threshold');
      expect(result.key).toBe('rag_confidence_threshold');
      expect(result.value).toBe('0.6');
    });

    it('throws NotFoundException when the key does not exist', async () => {
      const prisma = makePrismaMock([]);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      await expect(service.getOne('nonexistent_key')).rejects.toThrow(NotFoundException);
    });

    it('includes the correct key in the error message', async () => {
      const prisma = makePrismaMock([]);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      await expect(service.getOne('missing_key')).rejects.toThrow("SystemConfig key 'missing_key' not found");
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates value of an existing entry and returns the updated entry', async () => {
      const entries = [makeEntry('rag_confidence_threshold', '0.6')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      const result = await service.update('rag_confidence_threshold', { value: '0.75' });
      expect(result.value).toBe('0.75');
    });

    it('throws NotFoundException when the key does not exist', async () => {
      const entries: Entry[] = [];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      await expect(service.update('nonexistent_key', { value: 'true' })).rejects.toThrow(NotFoundException);
    });

    it('includes the missing key in the NotFoundException message', async () => {
      const prisma = makePrismaMock([]);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      await expect(service.update('missing_key', { value: 'x' })).rejects.toThrow(
        "SystemConfig key 'missing_key' not found",
      );
    });

    it('updates description when supplied', async () => {
      const entries = [makeEntry('llm_timeout_ms', '10000', 'Old description')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      const result = await service.update('llm_timeout_ms', {
        value: '15000',
        description: 'Updated description',
      });
      expect(result.value).toBe('15000');
    });

    it('calls SystemConfigService.invalidateCache() after a successful update', async () => {
      const entries = [makeEntry('rag_confidence_threshold', '0.6')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      await service.update('rag_confidence_threshold', { value: '0.8' });

      expect(systemConfig.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('does not call invalidateCache when the key does not exist', async () => {
      const prisma = makePrismaMock([]);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      await expect(service.update('ghost_key', { value: '1' })).rejects.toThrow(NotFoundException);

      expect(systemConfig.invalidateCache).not.toHaveBeenCalled();
    });

    it('passes correct update shape to Prisma', async () => {
      const entries = [makeEntry('widget_status', 'online')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      await service.update('widget_status', { value: 'offline', description: 'Maintenance' });

      expect(prisma.systemConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'widget_status' },
          data: expect.objectContaining({ value: 'offline' }),
        }),
      );
    });

    it('fires audit log with correct before and after values', async () => {
      const entries = [makeEntry('rag_confidence_threshold', '0.6')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const auditService = makeAuditServiceMock();
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      await service.update('rag_confidence_threshold', { value: '0.9' });

      // Allow fire-and-forget to settle
      await Promise.resolve();

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'system_config_updated',
          eventData: expect.objectContaining({
            key: 'rag_confidence_threshold',
            before: { value: '0.6' },
            after: { value: '0.9' },
          }),
        }),
      );
    });

    it('resolves successfully even when AuditService.log rejects', async () => {
      const entries = [makeEntry('rag_confidence_threshold', '0.6')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock();
      const auditService = { log: jest.fn().mockRejectedValue(new Error('DB write failure')) };
      const service = new AdminSystemConfigService(prisma as never, systemConfig as never, auditService as never);

      await expect(service.update('rag_confidence_threshold', { value: '0.8' })).resolves.toBeDefined();
    });
  });
});
