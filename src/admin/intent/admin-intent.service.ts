import { Injectable, NotFoundException } from '@nestjs/common';
import type { IntentTemplate } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntentService } from '../../intent/intent.service';
import { CreateIntentTemplateDto, UpdateIntentTemplateDto } from './dto/intent-admin.dto';

/**
 * AdminIntentService — admin CRUD for intent templates.
 *
 * Writes directly to `intent_templates` via PrismaService (global), then
 * calls `IntentService.invalidateCache()` so the in-memory detection cache
 * reflects changes immediately without a restart.
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Injectable()
export class AdminIntentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentService: IntentService,
  ) {}

  /** Return all intent templates ordered by priority (desc) then id. */
  async listAll(): Promise<IntentTemplate[]> {
    return this.prisma.intentTemplate.findMany({
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * Return a single IntentTemplate by id.
   *
   * @throws NotFoundException when no template exists for the given id.
   */
  async getOne(id: number): Promise<IntentTemplate> {
    const entry = await this.prisma.intentTemplate.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException(`IntentTemplate #${id} not found`);
    return entry;
  }

  /**
   * Create a new IntentTemplate and reload the intent cache.
   *
   * The new template is immediately available for detection after this call.
   */
  async create(dto: CreateIntentTemplateDto): Promise<IntentTemplate> {
    const entry = await this.prisma.intentTemplate.create({
      data: {
        intent: dto.intent,
        label: dto.label,
        keywords: dto.keywords,
        templateZh: dto.templateZh,
        templateEn: dto.templateEn,
        priority: dto.priority ?? 0,
        category: dto.category ?? null,
        isActive: true,
      },
    });
    await this.intentService.invalidateCache();
    return entry;
  }

  /**
   * Partially update an IntentTemplate and reload the intent cache.
   *
   * Only the fields present in the DTO are updated.
   *
   * @throws NotFoundException when no template exists for the given id.
   */
  async update(id: number, dto: UpdateIntentTemplateDto): Promise<IntentTemplate> {
    await this.getOne(id);
    const entry = await this.prisma.intentTemplate.update({
      where: { id },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.keywords !== undefined && { keywords: dto.keywords }),
        ...(dto.templateZh !== undefined && { templateZh: dto.templateZh }),
        ...(dto.templateEn !== undefined && { templateEn: dto.templateEn }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    await this.intentService.invalidateCache();
    return entry;
  }

  /**
   * Disable an IntentTemplate by setting `isActive = false`.
   *
   * The record is retained for audit purposes; the template will be excluded
   * from intent detection after the next cache reload.
   *
   * @throws NotFoundException when no template exists for the given id.
   */
  async disable(id: number): Promise<IntentTemplate> {
    await this.getOne(id);
    const entry = await this.prisma.intentTemplate.update({
      where: { id },
      data: { isActive: false },
    });
    await this.intentService.invalidateCache();
    return entry;
  }

  /** Manually trigger an IntentService cache reload from the database. */
  async invalidateCacheManual(): Promise<void> {
    await this.intentService.invalidateCache();
  }
}
