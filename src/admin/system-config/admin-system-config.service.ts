import { Injectable, NotFoundException } from '@nestjs/common';
import { SystemConfig } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { UpdateSystemConfigDto } from './dto/system-config-admin.dto';

/**
 * AdminSystemConfigService — CRUD operations for the `system_configs` table.
 *
 * After every write the in-memory cache of SystemConfigService is invalidated
 * so that changes take effect immediately without a server restart.
 */
@Injectable()
export class AdminSystemConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigService,
    private readonly auditService: AuditService,
  ) {}

  /** Return all SystemConfig entries ordered by key. */
  async listAll(): Promise<SystemConfig[]> {
    return this.prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
  }

  /**
   * Return a single SystemConfig entry by key.
   *
   * @throws NotFoundException when no entry exists for the given key.
   */
  async getOne(key: string): Promise<SystemConfig> {
    const entry = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!entry) throw new NotFoundException(`SystemConfig key '${key}' not found`);
    return entry;
  }

  /**
   * Update an existing SystemConfig entry by key.
   *
   * @throws NotFoundException when the key does not exist.
   *
   * After the write:
   *  1. The in-memory cache is synchronously invalidated via
   *     SystemConfigService.invalidateCache().
   *  2. An audit event system_config_updated is appended fire-and-forget;
   *     a rejection from the audit write never propagates to the caller.
   */
  async update(key: string, data: UpdateSystemConfigDto): Promise<SystemConfig> {
    const existing = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`SystemConfig key '${key}' not found`);

    const oldValue = existing.value;

    const result = await this.prisma.systemConfig.update({
      where: { key },
      data: {
        value: data.value,
        ...(data.description !== undefined && { description: data.description }),
      },
    });

    await this.systemConfig.invalidateCache();

    void this.auditService
      .log({
        eventType: 'system_config_updated',
        eventData: {
          key,
          before: { value: oldValue },
          after: { value: data.value },
        },
      })
      .catch(() => undefined);

    return result;
  }
}
