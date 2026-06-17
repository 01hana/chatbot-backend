import { PrismaClient } from '../../src/generated/prisma/client';

const KNOWLEDGE_CATEGORIES = [
  {
    key: 'faq-general',
    label: '常見問題',
    description: '一般 FAQ 類知識',
    defaultIntentLabel: 'general-faq',
    isActive: true,
    sortOrder: 10,
  },
  {
    key: 'product-spec',
    label: '產品規格',
    description: '產品規格、尺寸、材質、型號等知識',
    defaultIntentLabel: 'product-inquiry',
    isActive: true,
    sortOrder: 20,
  },
  {
    key: 'selection-guide',
    label: '選型指南',
    description: '協助使用者選擇適合產品的知識',
    defaultIntentLabel: 'product-inquiry',
    isActive: true,
    sortOrder: 30,
  },
  {
    key: 'pricing-info',
    label: '報價資訊',
    description: '報價、詢價、價格規則相關知識',
    defaultIntentLabel: 'price-inquiry',
    isActive: true,
    sortOrder: 40,
  },
] as const;

export async function seedKnowledgeCategories(prisma: PrismaClient): Promise<void> {
  console.log('  Seeding KnowledgeCategory...');
  let upserted = 0;

  for (const category of KNOWLEDGE_CATEGORIES) {
    await prisma.knowledgeCategory.upsert({
      where: { key: category.key },
      update: {
        label: category.label,
        description: category.description,
        defaultIntentLabel: category.defaultIntentLabel,
        isActive: category.isActive,
        sortOrder: category.sortOrder,
        deletedAt: null,
      },
      create: category,
    });
    upserted++;
  }

  console.log(`  KnowledgeCategory: ${upserted} entries upserted`);
}
