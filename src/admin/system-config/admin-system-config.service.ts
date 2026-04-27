import { Injectable, NotFoundException } from '@nestjs/common';
import { SystemConfig } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
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
   * Upsert a SystemConfig entry and immediately invalidate the in-memory cache.
   *
   * `update` is a no-op guard on `key` (PK) — the real update targets `value`
   * and optionally `description`.
   */
  async update(key: string, data: UpdateSystemConfigDto): Promise<SystemConfig> {
    const result = await this.prisma.systemConfig.upsert({
      where: { key },
      update: {
        value: data.value,
        ...(data.description !== undefined && { description: data.description }),
      },
      create: {
        key,
        value: data.value,
        ...(data.description !== undefined && { description: data.description }),
      },
    });
    await this.systemConfig.invalidateCache();
    return result;
  }
}
