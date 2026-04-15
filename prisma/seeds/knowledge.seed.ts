/**
 * knowledge.seed.ts — Phase 1 T1-005 (development / test only)
 *
 * IMPORTANT: This seed is ONLY executed when NODE_ENV is NOT 'production'.
 * Enforcement is in seed.ts (the main entry point).
 *
 * Seeds 5 representative KnowledgeEntry rows with different intentLabels and
 * tags so the RAG retrieval pipeline has data to work with during development.
 */
import { PrismaClient } from '../../src/generated/prisma/client';

const KNOWLEDGE_ENTRIES: {
  title: string;
  content: string;
  intentLabel: string;
  tags: string[];
}[] = [
  {
    title: 'O型環材質選用指南',
    content:
      'O型環常見材質包括 NBR（丁腈橡膠）、FKM（氟橡膠）、矽橡膠（VMQ）及 EPDM。NBR 適合耐油環境，使用溫度範圍 -40°C ~ 120°C；FKM 耐高溫及化學品，適合 -20°C ~ 200°C；矽橡膠耐高溫（-60°C ~ 230°C），不耐礦物油；EPDM 適合水、蒸氣及低濃度酸鹼，不耐石油類溶劑。選材時應考慮介質、溫度及壓力三大因素。',
    intentLabel: 'product-inquiry',
    tags: ['O型環', 'NBR', 'FKM', '矽橡膠', 'EPDM', '材質選擇'],
  },
  {
    title: '機械密封常見故障排除',
    content:
      '機械密封故障通常表現為洩漏、異常振動或過熱。洩漏原因常見有：密封面損傷、O型環老化或硬化、安裝不當（密封面不平行）。排查步驟：1) 確認密封面是否有刮痕；2) 檢查輔助密封件尺寸是否正確；3) 確認彈簧壓縮量是否符合規格；4) 檢查軸的徑向跳動是否超差（應 ≤ 0.05mm）。',
    intentLabel: 'product-diagnosis',
    tags: ['機械密封', '故障診斷', '洩漏', '維修'],
  },
  {
    title: '工業閥門規格與選型說明',
    content:
      '工業閥門選型應考慮：介質（液體/氣體/蒸氣）、操作壓力（PN 等級）、溫度範圍、連接方式（法蘭/螺紋/對焊）及材質（碳鋼/不鏽鋼/鑄鐵）。球閥適合快速截止，蝶閥適合大管徑流量調節，截止閥適合精確流量控制，閘閥適合全開全關不宜調節。報價時請提供口徑（DN）、壓力等級（PN/Class）及介質資訊。',
    intentLabel: 'price-inquiry',
    tags: ['閥門', '球閥', '蝶閥', '截止閥', '選型', '報價'],
  },
  {
    title: '橡膠密封件保存與使用壽命',
    content:
      '橡膠密封件應存放於陰涼乾燥處，避免直射陽光及臭氧環境。建議存放溫度 15°C ~ 25°C，相對濕度 45% ~ 75%。未開封原廠包裝，NBR/FKM 建議存放期限為 5 年，矽橡膠為 3 年，EPDM 為 5 年。使用前應確認密封件無裂紋、硬化或表面損傷。安裝時使用適量潤滑脂，避免使用石油系溶劑清潔。',
    intentLabel: 'general-faq',
    tags: ['保存', '存放', '使用壽命', '密封件', '保養'],
  },
  {
    title: '客製化密封件訂製流程',
    content:
      '非標準尺寸密封件可依客戶需求客製化生產。訂製流程：1) 提供尺寸圖（含截面圖及公差要求）；2) 說明材質需求及使用環境；3) 提供目標數量；4) 工程確認打樣（樣品製作時間約 5~10 個工作天）；5) 樣品確認後進入量產。最小訂購量（MOQ）依材質及尺寸而定，一般為 50~200 pcs。交期提供前請先詢問當前備料狀況。',
    intentLabel: 'product-inquiry',
    tags: ['客製化', 'OEM', '訂製', 'MOQ', '交期', '打樣'],
  },
];

export async function seedKnowledge(prisma: PrismaClient): Promise<void> {
  console.log('  Seeding KnowledgeEntry (development only)...');
  let created = 0;

  for (const entry of KNOWLEDGE_ENTRIES) {
    const existing = await prisma.knowledgeEntry.findFirst({
      where: { title: entry.title },
    });

    if (!existing) {
      await prisma.knowledgeEntry.create({
        data: {
          title: entry.title,
          content: entry.content,
          intentLabel: entry.intentLabel,
          tags: entry.tags,
          status: 'approved',
          visibility: 'public',
          version: 1,
        },
      });
      created++;
    }
  }

  console.log(`  KnowledgeEntry: ${created} entries created (${KNOWLEDGE_ENTRIES.length - created} already existed)`);
}
