/**
 * blacklist.seed.ts — Phase 1 T1-003
 *
 * Seeds conservative default confidential / sensitive keyword entries.
 * This list is intentionally minimal; the full production list should be
 * supplied by the client and managed through the Admin API.
 */
import { PrismaClient } from '../../src/generated/prisma/client';

const BLACKLIST_ENTRIES: { keyword: string; type: string }[] = [
  // pricing_sensitive — internal cost / margin information
  { keyword: '成本價',    type: 'pricing_sensitive' },
  { keyword: '進貨價',    type: 'pricing_sensitive' },
  { keyword: '底價',      type: 'pricing_sensitive' },
  { keyword: '供應商報價', type: 'pricing_sensitive' },
  { keyword: '毛利',      type: 'pricing_sensitive' },
  { keyword: '折扣碼',    type: 'pricing_sensitive' },
  // internal — personnel and operational data
  { keyword: '員工名單',  type: 'internal' },
  { keyword: '薪資',      type: 'internal' },
  { keyword: '內部通訊',  type: 'internal' },
  { keyword: '客戶資料庫', type: 'internal' },
  // confidential — legal / contractual
  { keyword: '保密協議',  type: 'confidential' },
  { keyword: 'NDA',       type: 'confidential' },
];

export async function seedBlacklist(prisma: PrismaClient): Promise<void> {
  console.log('  Seeding BlacklistEntry...');
  let upserted = 0;

  for (const entry of BLACKLIST_ENTRIES) {
    await prisma.blacklistEntry.upsert({
      where: { keyword: entry.keyword },
      update: { type: entry.type, isActive: true },
      create: { keyword: entry.keyword, type: entry.type, isActive: true },
    });
    upserted++;
  }

  console.log(`  BlacklistEntry: ${upserted} entries upserted`);
}
