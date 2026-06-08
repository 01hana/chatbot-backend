import { Injectable, NotFoundException } from '@nestjs/common';
import type { IntentTemplate } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntentService } from '../../intent/intent.service';
import {
  CreateIntentTemplateDto,
  UpdateIntentTemplateDto,
  ListIntentTemplateQueryDto,
} from './dto/intent-admin.dto';

const INTENT_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'title',
  'label',
  'priority',
  'category',
  'isActive',
]);

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

  /** Return paginated intent templates ordered by priority (desc) then id by default. */
  async listAll(
    query: ListIntentTemplateQueryDto = {},
  ): Promise<{ data: IntentTemplate[]; meta: { total: number; page: number; pageSize: number } }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const safeSortBy =
      query.sortBy && INTENT_SORT_FIELDS.has(query.sortBy) ? query.sortBy : undefined;
    const sortOrder = query.sortOrder ?? 'desc';

    const where = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
      ...(query.keyword
        ? {
            OR: [
              { title: { contains: query.keyword, mode: 'insensitive' as const } },
              { label: { contains: query.keyword, mode: 'insensitive' as const } },
              { templateZh: { contains: query.keyword, mode: 'insensitive' as const } },
              { templateEn: { contains: query.keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const orderBy = safeSortBy
      ? [{ [safeSortBy]: sortOrder }, { id: 'asc' as const }]
      : [{ priority: 'desc' as const }, { id: 'asc' as const }];

    const [items, total] = await Promise.all([
      this.prisma.intentTemplate.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.intentTemplate.count({ where }),
    ]);

    return { data: items, meta: { total, page, pageSize } };
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
        title: dto.title,
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
