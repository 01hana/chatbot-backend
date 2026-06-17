import { Injectable } from '@nestjs/common';
import { KnowledgeCategory } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface KnowledgeCategoryOptionVm {
  label: string;
  value: string;
  description?: string | null;
  defaultIntentLabel?: string | null;
}

export type KnowledgeCategoryVm = KnowledgeCategory;

export type CreateKnowledgeCategoryData = Pick<KnowledgeCategory, 'key' | 'label'> &
  Partial<
    Pick<
      KnowledgeCategory,
      'description' | 'defaultIntentLabel' | 'isActive' | 'sortOrder'
    >
  >;

export type UpdateKnowledgeCategoryData = Partial<
  Pick<
    KnowledgeCategory,
    'label' | 'description' | 'defaultIntentLabel' | 'isActive' | 'sortOrder' | 'deletedAt'
  >
>;

@Injectable()
export class KnowledgeCategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveOptions(): Promise<KnowledgeCategoryOptionVm[]> {
    const categories = await this.prisma.knowledgeCategory.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });

    return categories.map(category => ({
      label: category.label,
      value: category.key,
      description: category.description,
      defaultIntentLabel: category.defaultIntentLabel,
    }));
  }

  async findByKey(key: string): Promise<KnowledgeCategory | null> {
    return this.prisma.knowledgeCategory.findUnique({ where: { key } });
  }

  async findActiveByKey(key: string): Promise<KnowledgeCategory | null> {
    return this.prisma.knowledgeCategory.findFirst({
      where: { key, isActive: true, deletedAt: null },
    });
  }

  async create(data: CreateKnowledgeCategoryData): Promise<KnowledgeCategory> {
    return this.prisma.knowledgeCategory.create({
      data: {
        key: data.key,
        label: data.label,
        description: data.description ?? null,
        defaultIntentLabel: data.defaultIntentLabel ?? null,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async update(key: string, data: UpdateKnowledgeCategoryData): Promise<KnowledgeCategory> {
    return this.prisma.knowledgeCategory.update({
      where: { key },
      data,
    });
  }

  async softDelete(key: string): Promise<KnowledgeCategory> {
    return this.prisma.knowledgeCategory.update({
      where: { key },
      data: { isActive: false, deletedAt: new Date() },
    });
  }
}
