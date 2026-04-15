/**
 * glossary-terms.seed.ts — Phase 1 T1-004
 *
 * Seeds initial GlossaryTerm rows with product terminology and synonyms.
 * These are conservative defaults; the full production glossary should be
 * supplied by the client and managed through the Admin API.
 */
import { PrismaClient } from '../../src/generated/prisma/client';

const GLOSSARY_TERMS: {
  term: string;
  synonyms: string[];
  intentLabel?: string;
}[] = [
  { term: '橡膠密封圈', synonyms: ['O型環', 'O-ring', 'O ring', '密封件'], intentLabel: 'product-inquiry' },
  { term: '機械密封', synonyms: ['mechanical seal', '端面密封', '機封'], intentLabel: 'product-inquiry' },
  { term: '工業閥門', synonyms: ['valve', '閥', '截止閥', '球閥', '蝶閥', '閘閥'], intentLabel: 'product-inquiry' },
  { term: '氟橡膠', synonyms: ['FKM', 'Viton', 'FFKM', '氟膠'], intentLabel: 'product-inquiry' },
  { term: '矽橡膠', synonyms: ['silicone rubber', '矽膠', 'VMQ', 'PVMQ'], intentLabel: 'product-inquiry' },
  { term: '耐油橡膠', synonyms: ['NBR', '丁腈橡膠', 'nitrile rubber'], intentLabel: 'product-inquiry' },
  { term: '耐高溫材料', synonyms: ['High temperature material', '耐熱', 'heat resistant'], intentLabel: 'product-diagnosis' },
  { term: '壓力測試', synonyms: ['pressure test', '水壓測試', '氣密測試', '洩漏測試'], intentLabel: 'product-diagnosis' },
  { term: '材質認證', synonyms: ['material certificate', 'COA', 'ROHS', '食品級認證', 'FDA'], intentLabel: 'price-inquiry' },
  { term: '最小訂購量', synonyms: ['MOQ', 'minimum order', '起訂量'], intentLabel: 'price-inquiry' },
  { term: '客製化', synonyms: ['custom', 'OEM', '訂製', '特殊規格'], intentLabel: 'product-inquiry' },
  { term: '交期', synonyms: ['lead time', '出貨時間', '交貨日', '備貨期'], intentLabel: 'general-faq' },
];

export async function seedGlossaryTerms(prisma: PrismaClient): Promise<void> {
  console.log('  Seeding GlossaryTerm...');
  let upserted = 0;

  for (const glossary of GLOSSARY_TERMS) {
    await prisma.glossaryTerm.upsert({
      where: { term: glossary.term },
      update: { synonyms: glossary.synonyms, intentLabel: glossary.intentLabel ?? null },
      create: glossary,
    });
    upserted++;
  }

  console.log(`  GlossaryTerm: ${upserted} entries upserted`);
}
