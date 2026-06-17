import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeCategory } from '../generated/prisma/client';
import { IntentService } from '../intent/intent.service';
import {
  CreateKnowledgeCategoryDto,
  UpdateKnowledgeCategoryDto,
} from './dto/knowledge-category.dto';
import {
  KnowledgeCategoryOptionVm,
  KnowledgeCategoryVm,
  KnowledgeCategoryRepository,
} from './knowledge-category.repository';

@Injectable()
export class KnowledgeCategoryService {
  constructor(
    private readonly repository: KnowledgeCategoryRepository,
    private readonly intentService: IntentService,
  ) {}

  findActiveOptions(): Promise<KnowledgeCategoryOptionVm[]> {
    return this.repository.findActiveOptions();
  }

  findByKey(key: string): Promise<KnowledgeCategory | null> {
    return this.repository.findByKey(key);
  }

  findActiveByKey(key: string): Promise<KnowledgeCategory | null> {
    return this.repository.findActiveByKey(key);
  }

  async create(dto: CreateKnowledgeCategoryDto): Promise<KnowledgeCategoryVm> {
    const existing = await this.repository.findByKey(dto.key);
    if (existing) {
      throw new BadRequestException(`Knowledge category already exists: ${dto.key}`);
    }

    this.assertDefaultIntentLabel(dto.defaultIntentLabel);

    return this.repository.create({
      key: dto.key,
      label: dto.label,
      description: dto.description ?? null,
      defaultIntentLabel: dto.defaultIntentLabel ?? null,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });
  }

  async update(key: string, dto: UpdateKnowledgeCategoryDto): Promise<KnowledgeCategoryVm> {
    const existing = await this.repository.findByKey(key);
    if (!existing) {
      throw new NotFoundException(`Knowledge category ${key} not found`);
    }

    if (dto.defaultIntentLabel !== undefined) {
      this.assertDefaultIntentLabel(dto.defaultIntentLabel);
    }

    return this.repository.update(key, {
      ...(dto.label !== undefined && { label: dto.label }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.defaultIntentLabel !== undefined && {
        defaultIntentLabel: dto.defaultIntentLabel,
      }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
    });
  }

  async softDelete(key: string): Promise<KnowledgeCategoryVm> {
    const existing = await this.repository.findByKey(key);
    if (!existing) {
      throw new NotFoundException(`Knowledge category ${key} not found`);
    }

    return this.repository.softDelete(key);
  }

  async assertActiveCategory(key: string): Promise<KnowledgeCategory> {
    const category = await this.repository.findActiveByKey(key);
    if (!category) {
      throw new BadRequestException(`Unknown or inactive knowledge category: ${key}`);
    }
    return category;
  }

  assertDefaultIntentLabel(defaultIntentLabel?: string | null): void {
    const intentLabel = this.cleanValue(defaultIntentLabel);
    if (!intentLabel) return;

    const exists = this.intentService
      .getCachedTemplates()
      .some(template => template.title === intentLabel && template.isActive !== false);

    if (!exists) {
      throw new BadRequestException(`Unknown or inactive defaultIntentLabel: ${intentLabel}`);
    }
  }

  async resolveDefaultIntentLabel(key: string): Promise<string | null> {
    const category = await this.assertActiveCategory(key);
    const defaultIntentLabel = this.cleanValue(category.defaultIntentLabel);
    if (!defaultIntentLabel) return null;

    this.assertDefaultIntentLabel(defaultIntentLabel);
    return defaultIntentLabel;
  }

  private cleanValue(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }
}
