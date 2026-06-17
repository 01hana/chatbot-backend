import { BadRequestException } from '@nestjs/common';
import { IntentService } from '../intent/intent.service';
import { KnowledgeCategoryService } from '../knowledge-category/knowledge-category.service';
import { KnowledgeClassificationService } from './knowledge-classification.service';

function makeService(
  templates: Array<{ title: string; isActive?: boolean }> = [],
  defaultIntentLabels: Record<string, string | null> = {},
) {
  const knowledgeCategoryService = {
    resolveDefaultIntentLabel: jest.fn(async (category: string) => {
      if (category === 'unknown-category') {
        throw new BadRequestException(`Unknown or inactive knowledge category: ${category}`);
      }
      if (category === 'inactive-category') {
        throw new BadRequestException(`Unknown or inactive knowledge category: ${category}`);
      }
      if (category === 'deleted-category') {
        throw new BadRequestException(`Unknown or inactive knowledge category: ${category}`);
      }
      if (category === 'inactive-default' || category === 'missing-default') {
        throw new BadRequestException('Unknown or inactive defaultIntentLabel');
      }
      return defaultIntentLabels[category] ?? null;
    }),
  } as unknown as KnowledgeCategoryService;

  return new KnowledgeClassificationService(
    {
      getCachedTemplates: jest.fn().mockReturnValue(templates),
    } as unknown as IntentService,
    knowledgeCategoryService,
  );
}

describe('KnowledgeClassificationService', () => {
  describe('resolveIntentLabel()', () => {
    it('lets explicit active intentLabel win over category default', async () => {
      const service = makeService(
        [
          { title: 'price-inquiry', isActive: true },
          { title: 'product-inquiry', isActive: true },
        ],
        { 'product-spec': 'product-inquiry' },
      );

      await expect(
        service.resolveIntentLabel({
          category: 'product-spec',
          intentLabel: 'price-inquiry',
        }),
      ).resolves.toBe('price-inquiry');
    });

    it('rejects explicitly provided unknown or inactive intent labels', async () => {
      const service = makeService([{ title: 'inactive-intent', isActive: false }]);

      await expect(
        service.resolveIntentLabel({ intentLabel: 'inactive-intent' }),
      ).rejects.toThrow(BadRequestException);
      await expect(service.resolveIntentLabel({ intentLabel: 'missing-intent' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('resolves category defaults from KnowledgeCategoryService', async () => {
      const service = makeService(
        [
          { title: 'product-inquiry', isActive: true },
          { title: 'general-faq', isActive: true },
        ],
        {
          'product-spec': 'product-inquiry',
          'faq-general': 'general-faq',
        },
      );

      await expect(service.resolveIntentLabel({ category: 'product-spec' })).resolves.toBe(
        'product-inquiry',
      );
      await expect(service.resolveIntentLabel({ category: 'faq-general' })).resolves.toBe(
        'general-faq',
      );
    });

    it('rejects unknown, inactive, or deleted categories', async () => {
      const service = makeService();

      await expect(service.resolveIntentLabel({ category: 'unknown-category' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.resolveIntentLabel({ category: 'inactive-category' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.resolveIntentLabel({ category: 'deleted-category' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns null when category defaultIntentLabel is null', async () => {
      const service = makeService([], { 'custom-category': null });

      await expect(service.resolveIntentLabel({ category: 'custom-category' })).resolves.toBeNull();
    });

    it('rejects unknown or inactive category defaultIntentLabel', async () => {
      const service = makeService(
        [{ title: 'inactive-intent', isActive: false }],
        {
          'inactive-default': 'inactive-intent',
          'missing-default': 'missing-intent',
        },
      );

      await expect(service.resolveIntentLabel({ category: 'inactive-default' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.resolveIntentLabel({ category: 'missing-default' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns null when category and intentLabel are both omitted', async () => {
      const service = makeService();

      await expect(service.resolveIntentLabel({})).resolves.toBeNull();
    });
  });

  describe('suggestTags()', () => {
    it('suggests title, category, intentLabel, and Chinese quoted terms', () => {
      const service = makeService();

      expect(
        service.suggestTags({
          title: '產品規格',
          category: 'product-spec',
          intentLabel: 'product-inquiry',
          content: '常見的產品規格有「螺絲」、「螺帽」、「螺栓」',
        }),
      ).toEqual(['產品規格', 'product-spec', 'product-inquiry', '螺絲', '螺帽', '螺栓']);
    });

    it('trims, de-duplicates, removes empty tags, and skips overly long tags', () => {
      const service = makeService();
      const longTag = '這是一個明顯超過三十個字的超長標籤應該被移除避免污染搜尋結果與管理介面';

      expect(
        service.mergeTags(
          ['  manual  ', '', 'manual'],
          service.suggestTags({
            title: ' manual ',
            category: 'product-spec',
            intentLabel: 'product-inquiry',
            content: `「螺絲」「${longTag}」`,
          }),
        ),
      ).toEqual(['manual', 'product-spec', 'product-inquiry', '螺絲']);
    });
  });
});
