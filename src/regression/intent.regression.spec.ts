/**
 * intent.regression.spec.ts — Intent detection regression baseline (RG-003)
 *
 * Tests IntentService.detect() accuracy against the golden intent fixtures
 * using actual seeded template keywords (no DB required — templates are
 * loaded via `loadCache()` with mocked repository returning the same keyword
 * sets as intent-templates.seed.ts).
 *
 * 「Design decisions」
 * - Seeded intents (4): product-inquiry, product-diagnosis, price-inquiry, general-faq
 * - `contact-inquiry` is NOT a seeded intent template. Contact queries are handled
 *   via retrieval (knowledge entry sourceKey='contact-inquiry'), not intent routing.
 *   Do NOT add contact-inquiry to this accuracy gate.
 *
 * 「Baseline (2026-04-28, seed v002)」
 * Templates: product-inquiry, product-diagnosis, price-inquiry, general-faq (4)
 * Fixtures:  10 positive cases + 2 null (no-match) cases
 * Result:    10/10 positive cases correct (100%, ≥ 85% gate passed)
 */

import { describe, beforeAll, it, expect, jest } from '@jest/globals';
import { IntentService } from '../intent/intent.service';
import { IntentRepository } from '../intent/intent.repository';
import { IntentTemplate, GlossaryTerm } from '../generated/prisma/client';
import { INTENT_FIXTURES } from './fixtures/intent.fixtures';

// ── Seed-equivalent templates ─────────────────────────────────────────────────

/**
 * Mirror of intent-templates.seed.ts — must stay in sync with the seed file.
 * The isActive / category fields follow KS-002 defaults.
 */
const SEEDED_TEMPLATES: IntentTemplate[] = [
  {
    id: 1,
    intent: 'product-inquiry',
    label: '產品詢問',
    keywords: ['產品', '型號', '規格', '尺寸', '材質', 'product', 'model', 'spec', 'size'],
    templateZh: '您好！請問您想了解哪項產品？',
    templateEn: 'Hi! Which product are you interested in?',
    priority: 10,
    isActive: true,
    category: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
  {
    id: 2,
    intent: 'product-diagnosis',
    label: '產品問診',
    keywords: ['問題', '故障', '異常', '壞掉', '不正常', '修', 'issue', 'broken', 'fault', 'problem', 'repair'],
    templateZh: '了解您遇到的狀況。',
    templateEn: 'I understand you are having an issue.',
    priority: 20,
    isActive: true,
    category: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
  {
    id: 3,
    intent: 'price-inquiry',
    label: '價格詢問',
    keywords: ['價格', '報價', '多少錢', '費用', '優惠', 'price', 'quote', 'cost', 'discount', 'how much'],
    templateZh: '感謝您的詢價。',
    templateEn: 'Thank you for your inquiry.',
    priority: 15,
    isActive: true,
    category: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
  {
    id: 4,
    intent: 'general-faq',
    label: '常見問題',
    keywords: ['如何', '怎麼', '什麼是', '說明', 'FAQ', 'how to', 'what is', 'explain', 'help'],
    templateZh: '您好！請問有什麼我可以協助您的嗎？',
    templateEn: 'Hello! How can I assist you today?',
    priority: 0,
    isActive: true,
    category: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
];

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Intent regression — IntentService.detect() accuracy', () => {
  let service: IntentService;

  beforeAll(async () => {
    const mockRepo = {
      findAllTemplates: jest.fn<() => Promise<IntentTemplate[]>>().mockResolvedValue(SEEDED_TEMPLATES),
      findAllGlossary: jest.fn<() => Promise<GlossaryTerm[]>>().mockResolvedValue([]),
    } as unknown as IntentRepository;

    service = new IntentService(mockRepo);
    // Populate the in-memory template cache (no DB needed)
    await service.loadCache();
  });

  // ── Per-fixture tests ─────────────────────────────────────────────────────

  it.each(INTENT_FIXTURES)(
    'detect("$query", $language) → expectedIntent=$expectedIntent',
    ({ query, language, expectedIntent, minConfidence }) => {
      const result = service.detect(query, language);

      expect(result.intentLabel).toBe(expectedIntent);
      expect(result.confidence).toBeGreaterThanOrEqual(minConfidence);
    },
  );

  // ── Aggregate accuracy gate ───────────────────────────────────────────────

  it('overall accuracy on positive-case fixtures is ≥ 85%', () => {
    const positiveCases = INTENT_FIXTURES.filter((f) => f.expectedIntent !== null);
    let correct = 0;

    for (const f of positiveCases) {
      const result = service.detect(f.query, f.language);
      if (result.intentLabel === f.expectedIntent) correct++;
    }

    const accuracy = correct / positiveCases.length;
    // Report the exact number for baseline documentation
    console.info(
      `[Intent regression] accuracy: ${correct}/${positiveCases.length} = ${(accuracy * 100).toFixed(1)}%`,
    );
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  // ── isActive=false guard ──────────────────────────────────────────────────

  it('a template with isActive=false is not matched', async () => {
    const templatesWithInactive: IntentTemplate[] = [
      ...SEEDED_TEMPLATES,
      {
        id: 99,
        intent: 'disabled-intent',
        label: 'Disabled',
        keywords: ['螺絲'],       // would otherwise match many queries
        templateZh: '',
        templateEn: '',
        priority: 100,
        isActive: false,          // disabled via IG-002
        category: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ];

    const mockRepo = {
      findAllTemplates: jest.fn<() => Promise<IntentTemplate[]>>().mockResolvedValue(templatesWithInactive),
      findAllGlossary: jest.fn<() => Promise<GlossaryTerm[]>>().mockResolvedValue([]),
    } as unknown as IntentRepository;

    const svc = new IntentService(mockRepo);
    await svc.loadCache();

    const result = svc.detect('螺絲規格有哪些', 'zh-TW');
    // 'disabled-intent' should never win because isActive=false
    expect(result.intentLabel).not.toBe('disabled-intent');
  });
});
