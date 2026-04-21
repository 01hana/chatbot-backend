/**
 * knowledge-public-zh.seed.ts — 公開知識庫（中文）補料
 *
 * 來源：https://www.ray-fu.com/products-tw（官網公開資訊，2026-04）
 * 策略：upsert by title — 可安全重複執行，不會重複插入。
 * 環境：所有環境（含 production），因資料來源為官網公開資訊。
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Upsert 鍵策略說明（過渡方案）                                       │
 * │                                                                     │
 * │  目前以 `title` 作為 upsert / merge 的識別鍵。                       │
 * │  此為當前可接受的過渡方案，適用於 demo / MVP 階段。                   │
 * │                                                                     │
 * │  長期維護風險：                                                      │
 * │   - 若 title 被更新，舊條目不會被自動合併，可能產生重複。             │
 * │   - 翻譯條目間沒有穩定的跨語言關聯鍵。                               │
 * │                                                                     │
 * │  TODO: 正式化時應為每個知識條目加入穩定的 `sourceKey`（例如          │
 * │        'screw-overview-zh-TW'），以 sourceKey 作為 upsert 依據，     │
 * │        並支援跨語言條目的明確關聯（如 en <-> zh-TW 對照）。           │
 * │        migration 設計：新增 sourceKey String @unique? 欄位，          │
 * │        並更新本 seed 與 en seed 一起補上對應的 sourceKey。            │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * 欄位責任說明：
 *  - `language`  — zh-TW。用於同語言優先檢索，不可由 tags 替代。
 *  - `aliases`   — FAQ 問法變體 / 自然語句別名，用於 FAQ-friendly 檢索。
 *                  不可把大量完整問句塞進 tags。
 *  - `tags`      — 產品關鍵字 / 類別標籤 / 規格識別碼，不應包含完整自然句。
 *
 * 覆蓋主題：
 *   - 線材（碳鋼、合金鋼、不鏽鋼）
 *   - 螺絲（鑽尾、乾牆、屋頂、木螺絲、機械、不鏽鋼等）
 *   - 螺栓（六角、法蘭、馬車、木螺栓）
 *   - 螺帽（六角、法蘭、尼龍、翼型等）
 *   - 華司（平、彈簧、鎖齒等）
 *   - 其他（釘子、鉚釘、管夾）
 *   - FAQ（聯絡方式、詢價、目錄下載）
 *   - 選型指南（支援 Phase 4 問診）
 */
import { PrismaClient } from '../../src/generated/prisma/client';

const SOURCE_TAG = 'source:website-public';

interface KnowledgeEntryInput {
  title: string;
  content: string;
  intentLabel: string;
  tags: string[];
  /** FAQ question variants and natural-language aliases for retrieval. */
  aliases?: string[];
}

const ZH_ENTRIES: KnowledgeEntryInput[] = [
  // ── 公司概述 ────────────────────────────────────────────────────────────
  {
    title: '瑞滬企業與震南鐵線公司簡介',
    content:
      '瑞滬企業股份有限公司（RAY FU ENTERPRISE CO., LTD.）為台灣扣件與線材外銷貿易商，' +
      '旗下母公司震南鐵線股份有限公司（CHEN NAN IRON WIRE CO., LTD.）負責生產。' +
      '主要產品涵蓋線材、螺絲、螺栓、螺帽、華司及其他五金扣件，供應全球工業客戶。' +
      '總部位於台灣高雄市。',
    intentLabel: 'general-faq',
    tags: ['公司簡介', '瑞滬', '震南', 'Ray Fu', 'Chen Nan', '扣件', '線材', SOURCE_TAG],
  },

  // ── 線材系列 ────────────────────────────────────────────────────────────
  {
    title: '線材產品總覽',
    content:
      '震南鐵線生產之線材線徑範圍為 1.78mm ~ 10mm，' +
      '主要材質為 AISI 1018–1022、10B21。' +
      '用途廣泛，包含產製扣件、彈簧線、排釘及各類五金零件等。' +
      '線材依材質可分為：碳鋼線材、合金鋼線材、不鏽鋼線材三大系列。',
    intentLabel: 'product-inquiry',
    tags: ['線材', 'wire', '線徑', '1.78mm', '10mm', 'AISI', '10B21', '碳鋼', '合金鋼', '不鏽鋼', SOURCE_TAG],
  },
  {
    title: '碳鋼線材規格與用途',
    content:
      '碳鋼線材（Carbon Steel Wire）材質規格涵蓋低碳至高碳鋼：' +
      'AISI 1006 ~ AISI 1060（或 JIS SWRCH 6A ~ SWRCH 50K）。' +
      '廣泛應用於一般扣件、彈簧、排釘及五金零件製造。' +
      '低碳鋼（AISI 1006–1018）延展性佳，適合冷鍛；' +
      '高碳鋼（AISI 1040–1060）強度較高，適合彈簧與高強度扣件。',
    intentLabel: 'product-inquiry',
    tags: ['碳鋼線材', 'carbon steel wire', 'AISI 1006', 'AISI 1060', 'SWRCH', '彈簧', '扣件', SOURCE_TAG],
  },
  {
    title: '合金鋼線材規格與用途',
    content:
      '合金鋼線材（Alloy Steel Wire）材質規格涵蓋鉻鋼及鉻鉬鋼系列：' +
      'AISI 5115 ~ AISI 5145（鉻鋼）、JIS SCr415 ~ SCr445，' +
      '以及 AISI 4120 ~ AISI 4150（鉻鉬鋼）等規格。' +
      '適合製造高強度扣件、汽車零件及精密機械零件。' +
      '比碳鋼更高的抗拉強度與韌性，常用於安全關鍵零件。',
    intentLabel: 'product-inquiry',
    tags: ['合金鋼線材', 'alloy steel wire', 'AISI 5115', 'AISI 4120', '鉻鋼', '鉻鉬鋼', '高強度', SOURCE_TAG],
  },
  {
    title: '不鏽鋼線材規格與用途',
    content:
      '不鏽鋼線材（Stainless Steel Wire）規格涵蓋 AISI/SAE 302 ~ 430 系列，' +
      '或對應日本標準 JIS SUS 302 ~ SUS 430，亦可依客戶指定其他標準供料。' +
      '耐腐蝕性優異，適合食品機械、醫療器材、戶外設施及化工設備等需要防銹的應用場景。' +
      '亦可供不鏽鋼螺絲、彈簧等精密扣件原料使用。',
    intentLabel: 'product-inquiry',
    tags: ['不鏽鋼線材', 'stainless steel wire', 'SUS 302', 'SUS 430', 'AISI 302', '耐腐蝕', '食品', '醫療', SOURCE_TAG],
  },
  {
    title: '線材材質選擇建議',
    content:
      '選擇線材材質時，建議依以下四個維度評估：' +
      '1. 用途（purpose）：一般扣件選碳鋼；高強度結構件選合金鋼；耐蝕場景選不鏽鋼。' +
      '2. 材質（material）：AISI 1018–1022 適合標準扣件；4120–4150 系列適合高強度需求；302–430 系列適合耐蝕需求。' +
      '3. 尺寸（size）：線徑 1.78mm ~ 10mm 依下游扣件規格決定。' +
      '4. 環境（environment）：戶外、食品、化工場合應優先考慮不鏽鋼或特殊塗層。',
    intentLabel: 'product-diagnosis',
    tags: ['線材選材', 'wire selection', '材質', '碳鋼', '合金鋼', '不鏽鋼', '用途', '環境', '問診', SOURCE_TAG],
  },

  // ── 螺絲系列 ────────────────────────────────────────────────────────────
  {
    title: '螺絲產品總覽',
    content:
      '螺絲產品規格範圍：M1.8 ~ M20，長度 2mm ~ 400mm。' +
      '主要類別包括：鑽尾螺絲、乾牆螺絲、鐵板螺絲、硬木螺絲、甲板螺絲、' +
      '六角承窩頭螺絲、屋頂螺絲、鏈帶螺絲、水泥螺絲、木螺絲、傢俱螺絲、' +
      '窗戶螺絲、機械螺絲、不鏽鋼螺絲等多種類型，可依應用場景選配。',
    intentLabel: 'product-inquiry',
    tags: ['螺絲', 'screw', 'M1.8', 'M20', '2mm', '400mm', '自攻', '自鑽', SOURCE_TAG],
    aliases: [
      '螺絲類別有哪些',
      '螺絲有哪幾種',
      '有哪些螺絲',
      '螺絲產品有哪些',
      '你們有哪些螺絲',
      '螺絲規格範圍',
    ],
  },
  {
    title: '鑽尾螺絲（Self-Drilling Screw）',
    content:
      '鑽尾螺絲（Self-Drilling Screw）是自鑽自攻螺絲的通稱。' +
      '其鑽頭造型可在金屬薄板上直接鑽孔並攻牙，無需預先鑽孔。' +
      '常用於金屬板材連接、鋼結構廠房、設備外殼等場合。' +
      '規格範圍：M3 ~ M8，長度 9mm ~ 150mm，' +
      '材質以碳鋼（鍍鋅）或不鏽鋼為主。',
    intentLabel: 'product-inquiry',
    tags: ['鑽尾螺絲', 'self-drilling screw', '自鑽', '金屬板', '鋼板', SOURCE_TAG],
  },
  {
    title: '乾牆螺絲（Drywall Screw）',
    content:
      '乾牆螺絲（Drywall Screw）專為固定石膏板（乾牆）設計。' +
      '特點：細牙設計可直接鎖入石膏板或木龍骨，頭部可埋入石膏板表面不凸出。' +
      '常見規格：M3.5 ~ M4.8，長度 25mm ~ 100mm。' +
      '廣泛應用於室內裝修、隔間牆、天花板等建築施工場合。',
    intentLabel: 'product-inquiry',
    tags: ['乾牆螺絲', 'drywall screw', '石膏板', '建築', '裝修', SOURCE_TAG],
  },
  {
    title: '屋頂螺絲（Roofing Screw）',
    content:
      '屋頂螺絲（Roofing Screw）專為屋頂材料固定設計，' +
      '通常附帶橡膠或 EPDM 防水墊圈，提供防水密封功能。' +
      '可鎖入金屬屋頂板、波浪板或木質屋架。' +
      '常見規格：M4.8 ~ M6.3，長度 20mm ~ 100mm。' +
      '材質以碳鋼鍍鋅或不鏽鋼為主，適合戶外長期使用。',
    intentLabel: 'product-inquiry',
    tags: ['屋頂螺絲', 'roofing screw', '防水', '屋頂', '戶外', SOURCE_TAG],
  },
  {
    title: '木螺絲（Wood Screw）',
    content:
      '木螺絲（Wood Screw）專為木材緊固設計，具有粗牙設計以提高握持力。' +
      '適用於傢俱、木地板、木結構及各類木工作業。' +
      '常見規格：M2.5 ~ M8，長度 10mm ~ 200mm。' +
      '材質以碳鋼（鍍鋅或電鍍）為主，亦有不鏽鋼選項。',
    intentLabel: 'product-inquiry',
    tags: ['木螺絲', 'wood screw', '木材', '傢俱', '粗牙', SOURCE_TAG],
  },
  {
    title: '水泥螺絲（Concrete Screw）',
    content:
      '水泥螺絲（Concrete Screw）主要用於將物件固定在混凝土、砌磚或石材上。' +
      '使用前需預先鑽孔，特殊牙型可在脆性基材中提供高拉拔強度。' +
      '常見規格：M5 ~ M10，長度 30mm ~ 200mm。' +
      '應用於工廠地坪固定、管路支架、機械底座安裝等場合。',
    intentLabel: 'product-inquiry',
    tags: ['水泥螺絲', 'concrete screw', '混凝土', '砌磚', '固定', SOURCE_TAG],
  },
  {
    title: '機械螺絲（Machine Screw）',
    content:
      '機械螺絲（Machine Screw）廣泛應用於機械設備及電子零件的緊固。' +
      '與螺帽或預攻牙孔搭配使用，具備標準公制細牙或粗牙規格。' +
      '常見規格：M1.6 ~ M12，長度 3mm ~ 100mm。' +
      '材質以碳鋼、不鏽鋼、黃銅為主，適合精密設備組裝。',
    intentLabel: 'product-inquiry',
    tags: ['機械螺絲', 'machine screw', '機械', '電子', '公制', '細牙', SOURCE_TAG],
  },
  {
    title: '不鏽鋼螺絲（Stainless Steel Screw）',
    content:
      '不鏽鋼螺絲（Stainless Steel Screw）泛指以不鏽鋼材質製造的各類螺絲。' +
      '常見材質：304（A2）、316（A4），耐腐蝕性優於碳鋼鍍鋅品。' +
      '適用於海洋、食品、化工、醫療等高腐蝕性環境。' +
      '各類型螺絲（自攻、木螺絲、機械螺絲等）均有不鏽鋼版本可供選配。',
    intentLabel: 'product-inquiry',
    tags: ['不鏽鋼螺絲', 'stainless steel screw', '304', '316', '耐腐蝕', '食品', '海洋', SOURCE_TAG],
  },
  {
    title: '螺絲規格選型建議',
    content:
      '選擇螺絲時建議評估以下四個問診維度：' +
      '1. 用途（purpose）：是否用於金屬板、木材、石膏板、混凝土或機械設備？' +
      '2. 材質（material）：一般用途選鍍鋅碳鋼；戶外或腐蝕環境選不鏽鋼。' +
      '3. 規格/長度（size）：M1.8~M20；長度 2mm~400mm，依被鎖材料厚度選定。' +
      '4. 環境（environment）：室內、戶外、潮濕、高溫或化學腐蝕環境各有對應建議。',
    intentLabel: 'product-diagnosis',
    tags: ['螺絲選型', 'screw selection', '材質', '規格', '用途', '環境', '問診', SOURCE_TAG],
  },

  // ── 螺栓系列 ────────────────────────────────────────────────────────────
  {
    title: '螺栓產品總覽',
    content:
      '螺栓（Bolt）產品規格範圍：M2 ~ M20，強度等級 4.6 ~ 8.8 級，長度 12mm ~ 120mm。' +
      '主要應用領域：機械設備、風力發電、汽機車、自行車、電桿、建築、電子等。' +
      '主要類別：六角螺栓（Hex Bolt）、法蘭螺栓（Flange Bolt）、' +
      '馬車螺栓（Carriage Bolt）、木螺栓（Lag Bolt）。',
    intentLabel: 'product-inquiry',
    tags: ['螺栓', 'bolt', 'M2', 'M20', '4.6級', '8.8級', '六角', '法蘭', '馬車', SOURCE_TAG],
  },
  {
    title: '六角螺栓（Hex Bolt）',
    content:
      '六角螺栓（Hex Bolt）是市場最普遍的螺栓類型，' +
      '以扳手鎖緊六角頭部，與螺帽搭配使用。' +
      '規格範圍：M3 ~ M20，強度等級 4.6 ~ 8.8（依 DIN/ISO 標準）。' +
      '應用於機械、建築鋼結構、橋梁及各類工業設備。',
    intentLabel: 'product-inquiry',
    tags: ['六角螺栓', 'hex bolt', '扳手', 'DIN', 'ISO', '建築', '機械', SOURCE_TAG],
  },
  {
    title: '法蘭螺栓（Flange Bolt）',
    content:
      '法蘭螺栓（Flange Bolt）在六角頭下方設有一體成型的法蘭（Flange）盤，' +
      '可分散鎖緊力、減少對被鎖件表面的損傷，並具有一定的防鬆功能。' +
      '常見於汽機車引擎、框架及需要防鬆的機械結構中。',
    intentLabel: 'product-inquiry',
    tags: ['法蘭螺栓', 'flange bolt', '汽車', '機車', '防鬆', '引擎', SOURCE_TAG],
  },
  {
    title: '馬車螺栓（Carriage Bolt）',
    content:
      '馬車螺栓（Carriage Bolt）又稱 Coach Bolt，頭部為圓形，' +
      '頭部下方有方形頸部可嵌入木材，防止螺栓旋轉，主要從螺帽端鎖緊。' +
      '廣泛用於木結構、庭院設施、農業設備及貨車廂體固定。',
    intentLabel: 'product-inquiry',
    tags: ['馬車螺栓', 'carriage bolt', 'coach bolt', '木結構', '農業', SOURCE_TAG],
  },
  {
    title: '木螺栓（Lag Bolt）',
    content:
      '木螺栓（Lag Bolt / Lag Screw）主要用於木材的重型緊固，' +
      '具粗牙及尖端設計，可直接旋入木材無需螺帽配合。' +
      '應用於大型木結構、貨架、棧板支架等重型場合。',
    intentLabel: 'product-inquiry',
    tags: ['木螺栓', 'lag bolt', 'lag screw', '木材', '重型', '木結構', SOURCE_TAG],
  },

  // ── 螺帽系列 ────────────────────────────────────────────────────────────
  {
    title: '螺帽產品總覽',
    content:
      '螺帽（Nut）產品規格範圍：M2 ~ M20。' +
      '主要類別：六角螺帽（Hex Nut）、法蘭螺帽（Hex Flange Nut）、' +
      '尼龍防鬆螺帽（Nylon Nut / Nyloc Nut）、翼型螺帽（Wing Nut）、' +
      '方形螺帽（Square Nut）、圓頂蓋形螺帽（Dome Cap Nut）、' +
      '籠形螺帽（Cage Nut）、面板螺帽（Panel Nut）。',
    intentLabel: 'product-inquiry',
    tags: ['螺帽', 'nut', '六角螺帽', '法蘭螺帽', '尼龍螺帽', '翼型螺帽', SOURCE_TAG],
  },
  {
    title: '六角螺帽（Hex Nut）',
    content:
      '六角螺帽（Hex Nut）是市場上最普遍的螺帽類型，' +
      '與六角螺栓或螺絲搭配使用，以扳手鎖緊。' +
      '規格遵循 ISO/DIN 標準，常見規格 M3 ~ M20。' +
      '廣泛應用於各類機械設備、建築結構及一般工業緊固場合。',
    intentLabel: 'product-inquiry',
    tags: ['六角螺帽', 'hex nut', 'ISO', 'DIN', '機械', '建築', SOURCE_TAG],
  },
  {
    title: '尼龍防鬆螺帽（Nylon Nut / Nyloc Nut）',
    content:
      '尼龍防鬆螺帽（Nylon Nut 或 Nyloc Nut）在六角螺帽頂端嵌入一個尼龍環，' +
      '利用尼龍環與螺牙的摩擦力提供防鬆功能，不需額外使用螺旋墊圈。' +
      '適合有振動或衝擊的場合，如汽機車、機械設備。' +
      '使用溫度：一般尼龍適合 -30°C ~ 120°C。',
    intentLabel: 'product-inquiry',
    tags: ['尼龍螺帽', 'nylon nut', 'nyloc nut', '防鬆', '振動', '汽車', SOURCE_TAG],
  },
  {
    title: '法蘭螺帽（Hex Flange Nut）',
    content:
      '法蘭螺帽（Hex Flange Nut）在六角螺帽底部設有一體式法蘭盤，' +
      '增大接觸面積以分散力道，並具有防鬆效果，兼具墊圈功能，安裝更方便。' +
      '廣泛用於汽機車、自行車、家電及一般工業組裝。',
    intentLabel: 'product-inquiry',
    tags: ['法蘭螺帽', 'hex flange nut', '汽車', '自行車', '防鬆', '家電', SOURCE_TAG],
  },

  // ── 華司系列 ────────────────────────────────────────────────────────────
  {
    title: '華司產品總覽',
    content:
      '華司（Washer）產品主要類別：' +
      '平華司（Flat Washer）、彈簧華司（Spring Lock Washer）、' +
      '外齒鎖緊華司（External Tooth Lock Washer）、' +
      '內齒鎖緊華司（Internal Tooth Lock Washer）、' +
      '傘型華司（Umbrella Washer）、複合式防水華司（Bonding Washer）。' +
      '規格範圍與螺栓螺帽系列對應，M2 ~ M20。',
    intentLabel: 'product-inquiry',
    tags: ['華司', 'washer', '平華司', '彈簧華司', '鎖緊華司', SOURCE_TAG],
  },
  {
    title: '平華司（Flat Washer）',
    content:
      '平華司（Flat Washer）是最基本的墊圈類型，' +
      '主要功能為分散螺栓頭或螺帽的鎖緊力，保護被鎖件表面不受損傷，' +
      '並可填補螺栓孔與螺栓間的間隙。' +
      '廣泛應用於各類機械、建築及一般緊固場合。' +
      '材質有碳鋼、不鏽鋼、鋁等選項。',
    intentLabel: 'product-inquiry',
    tags: ['平華司', 'flat washer', '墊圈', '分散力', '碳鋼', '不鏽鋼', SOURCE_TAG],
  },
  {
    title: '彈簧華司（Spring Lock Washer）',
    content:
      '彈簧華司（Spring Lock Washer）為開口彈性墊圈，' +
      '利用彈性張力提供防鬆功能，防止螺栓在振動或衝擊下鬆脫。' +
      '比平華司多了防鬆特性，常與六角螺栓、六角螺帽搭配使用。' +
      '廣泛應用於機械設備、電動工具、汽機車等有振動的場合。',
    intentLabel: 'product-inquiry',
    tags: ['彈簧華司', 'spring lock washer', '防鬆', '振動', '機械', SOURCE_TAG],
  },

  // ── 其他產品 ────────────────────────────────────────────────────────────
  {
    title: '其他五金產品：釘子（Nail）',
    content:
      '釘子（Nail）主要以碳鋼製成，為銷狀緊固件，廣泛用於木工作業。' +
      '常見類型包括：普通圓釘、螺旋釘（Spiral Nail）、環釘（Ring Shank Nail）等。' +
      '應用於木結構、裝修工程、棧板製造等場合。',
    intentLabel: 'product-inquiry',
    tags: ['釘子', 'nail', '碳鋼', '木工', '螺旋釘', SOURCE_TAG],
  },
  {
    title: '其他五金產品：鉚釘（Rivet）',
    content:
      '鉚釘（Rivet）是一種永久性緊固件，用於永久連接兩個或多個工件。' +
      '常用於金屬薄板連接、結構部件及需要防竄改的場合。' +
      '類型包括開口型（Pop Rivet / Blind Rivet）及實心鉚釘等。',
    intentLabel: 'product-inquiry',
    tags: ['鉚釘', 'rivet', '永久緊固', '金屬薄板', 'blind rivet', SOURCE_TAG],
  },
  {
    title: '其他五金產品：管夾（Hose Clamp）',
    content:
      '管夾（Hose Clamp）是專用於固定軟管與接頭連接的緊固件，' +
      '確保密封性防止洩漏。廣泛應用於汽車水管、工業管路、農業灌溉等場合。',
    intentLabel: 'product-inquiry',
    tags: ['管夾', 'hose clamp', '軟管', '密封', '汽車', '管路', SOURCE_TAG],
  },

  // ── FAQ ─────────────────────────────────────────────────────────────────
  {
    title: '聯絡方式與詢價說明',
    content:
      '瑞滬企業股份有限公司（貿易辦公室）：' +
      '地址：台灣高雄市左營區博愛二路366號23樓之1。電話：+886-7-556-0180。' +
      '傳真：+886-7-556-0174。信箱：export@ray-fu.com。官網：www.ray-fu.com。\n\n' +
      '震南鐵線股份有限公司（生產與實驗室）：' +
      '地址：高雄市路竹區順安路275巷202號。電話：+886-7-697-5852。' +
      '傳真：+886-7-697-5854。信箱：export@chen-nan.com.tw。\n\n' +
      '如需詢價，請透過官網聯絡表單或直接 e-mail 聯絡，說明所需規格與數量。',
    intentLabel: 'general-faq',
    tags: ['聯絡', '詢價', '報價', '電話', '信箱', 'export@ray-fu.com', '高雄', SOURCE_TAG],
    aliases: [
      '怎麼聯絡你們',
      '如何聯絡你們',
      '如何詢價',
      '怎麼詢價',
      '報價怎麼問',
      '聯絡業務方式',
      '如何報價',
      '怎麼跟你們聯絡',
      '客服電話',
    ],
  },
  {
    title: '產品目錄下載說明',
    content:
      '瑞滬企業提供以下產品目錄供下載：' +
      '1. Main Products（主要產品型錄）；' +
      '2. Ray Fu Catalogue-1；' +
      '3. Ray Fu Catalogue-2；' +
      '4. Ray Fu 2019 目錄。' +
      '目錄可於官網產品頁（https://www.ray-fu.com/products）下載。' +
      '如需最新版型錄，亦可直接聯繫業務索取。',
    intentLabel: 'general-faq',
    tags: ['型錄', '目錄', 'catalogue', '下載', 'PDF', SOURCE_TAG],
    aliases: [
      '如何下載型錄',
      '可以下載產品目錄嗎',
      '型錄怎麼下載',
      '目錄在哪裡下載',
      '怎麼取得型錄',
      '下載型錄的方式',
      '產品目錄哪裡有',
    ],
  },
  {
    title: '產品供應範圍與可供貨類別',
    content:
      '瑞滬企業 / 震南鐵線可供應之產品類別包括：' +
      '線材（Wire）、螺絲（Screws）、螺栓（Bolts）、螺帽（Nuts）、' +
      '華司（Washers）、釘子（Nails）、鉚釘（Rivets）、管夾（Hose Clamps），' +
      '以及特殊規格訂製品（Speciality）。' +
      '各類產品均可依客戶需求提供報價，如有特殊規格請來信說明。',
    intentLabel: 'general-faq',
    tags: ['供應範圍', '可供貨', '線材', '螺絲', '螺栓', '螺帽', '華司', '釘子', '鉚釘', SOURCE_TAG],
  },

  // ── 問診 / 選型指南（支援 Phase 4）────────────────────────────────────
  {
    title: '扣件規格選型建議指南',
    content:
      '選擇扣件前，建議釐清以下四個關鍵問題（問診四欄位）：\n' +
      '1. 用途（Purpose）：是結構固定、防鬆、防水、導電接地，還是其他特殊功能？\n' +
      '2. 材質（Material）：碳鋼（一般場合）、合金鋼（高強度）、不鏽鋼（耐蝕）、黃銅（導電）。\n' +
      '3. 規格 / 長度（Size / Diameter）：公制螺栓 M2~M20，螺絲 M1.8~M20，長度 2~400mm 可選。\n' +
      '4. 使用環境（Environment）：室內、戶外、潮濕、高鹽份、高溫、振動等。\n' +
      '依上述四維度可縮小選型範圍，再搭配具體類別（螺絲/螺栓/螺帽）選擇。',
    intentLabel: 'product-diagnosis',
    tags: ['選型', 'selection', '問診', 'purpose', 'material', 'size', 'environment', '規格', '扣件', SOURCE_TAG],
  },
  {
    title: '不同環境的扣件材質建議',
    content:
      '依使用環境選擇扣件材質的公開建議：\n' +
      '- 室內一般環境：鍍鋅碳鋼即可滿足需求，成本較低。\n' +
      '- 戶外一般環境：建議鍍鋅或粉體塗裝，使用壽命更長。\n' +
      '- 沿海 / 高鹽份環境：建議選用 304 或 316 不鏽鋼，耐鹽霧能力強。\n' +
      '- 食品 / 醫療環境：應使用 316 不鏽鋼，符合衛生要求。\n' +
      '- 高溫場合（>200°C）：需特殊高溫合金，請詢問業務確認可供規格。\n' +
      '- 振動場合：搭配防鬆螺帽（尼龍螺帽）或彈簧華司使用。',
    intentLabel: 'product-diagnosis',
    tags: ['環境', 'environment', '材質', '不鏽鋼', '碳鋼', '鍍鋅', '耐蝕', '振動', '問診', SOURCE_TAG],
  },
  {
    title: '工業應用場景與適用扣件對照',
    content:
      '不同工業應用場景的適用產品建議（依官網公開資訊）：\n' +
      '- 機械設備：六角螺栓（M5~M20，8.8級）+ 六角螺帽 + 平華司；機械螺絲（精密組裝）。\n' +
      '- 風力發電：高強度螺栓（8.8級以上）+ 法蘭螺帽，需嚴格防鬆。\n' +
      '- 汽機車：法蘭螺栓 + 法蘭螺帽（防鬆），尼龍螺帽（引擎振動部位）。\n' +
      '- 自行車：M4~M10 各類螺栓、螺絲；不鏽鋼材質適合戶外場合。\n' +
      '- 建築鋼構：六角螺栓（4.6~8.8級）+ 大型平華司。\n' +
      '- 電子設備：小型機械螺絲（M1.6~M4）、面板螺帽、籠形螺帽。\n' +
      '- 木結構：木螺絲、馬車螺栓、木螺栓（Lag Bolt）。',
    intentLabel: 'product-diagnosis',
    tags: ['應用場景', 'application', '機械', '風力', '汽車', '建築', '電子', '木結構', '問診', SOURCE_TAG],
  },
];

/**
 * Seed public Chinese knowledge entries.
 * Idempotent — creates missing entries and backfills `language` on existing ones.
 */
export async function seedKnowledgePublicZh(prisma: PrismaClient): Promise<void> {
  console.log('  Seeding KnowledgeEntry (public-zh)...');
  let created = 0;
  let skipped = 0;
  let backfilled = 0;

  for (const entry of ZH_ENTRIES) {
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
          aliases: entry.aliases ?? [],
          status: 'approved',
          visibility: 'public',
          version: 1,
          language: 'zh-TW',
        },
      });
      created++;
    } else {
      // Backfill: fix language and merge any new aliases
      const missingAliases = (entry.aliases ?? []).filter(
        a => !existing.aliases.includes(a),
      );
      const needsUpdate =
        existing.language !== 'zh-TW' || missingAliases.length > 0;

      if (needsUpdate) {
        await prisma.knowledgeEntry.update({
          where: { id: existing.id },
          data: {
            ...(existing.language !== 'zh-TW' ? { language: 'zh-TW' } : {}),
            ...(missingAliases.length > 0
              ? { aliases: [...existing.aliases, ...missingAliases] }
              : {}),
          },
        });
        backfilled++;
      } else {
        skipped++;
      }
    }
  }

  console.log(
    `  KnowledgeEntry (public-zh): ${created} created, ${backfilled} backfilled, ${skipped} already existed`,
  );
}
