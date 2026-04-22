/**
 * knowledge-public-en.seed.ts — Public Knowledge Base (English)
 *
 * Source: https://www.ray-fu.com/products (official public pages, April 2026)
 * Strategy: idempotent upsert by `sourceKey + language`.
 * Environment: All environments (including production), as data is from public website.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Upsert Key Strategy                                               │
 * │                                                                     │
 * │  This seed now uses `sourceKey + language` as the stable upsert     │
 * │  key, so it can be executed repeatedly without creating duplicates. │
 * │                                                                     │
 * │  Transitional compatibility:                                        │
 * │   - Before upsert, the seed backfills legacy rows that still match  │
 * │     by `title + language` but do not yet have a `sourceKey`.        │
 * │   - This keeps older demo / MVP data compatible during migration.   │
 * │                                                                     │
 * │  Current benefits:                                                  │
 * │   - Stable identity even if `title` is renamed                      │
 * │   - Safer repeated seeding (idempotent)                             │
 * │   - Better support for regression fixtures via `sourceKey`          │
 * │                                                                     │
 * │  Remaining productisation TODOs:                                    │
 * │   - Add / use `crossLanguageGroupKey` for explicit en <-> zh-TW     │
 * │     pairing                                                         │
 * │   - Gradually enrich entries with `faqQuestions`, `templateKey`,    │
 * │     and `structuredAttributes` where needed                         │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Field responsibilities:
 *  - `language`  — 'en'. Used for language-aware retrieval; never substitute with tags.
 *  - `aliases`   — FAQ question variants / natural-language phrasings for retrieval.
 *                  Do NOT put product keyword sentences in tags.
 *  - `tags`      — Product keywords, category labels, spec identifiers.
 *                  Should NOT contain full natural-language sentences.
 */
import { PrismaClient } from '../../src/generated/prisma/client';

const SOURCE_TAG = 'source:website-public';

interface KnowledgeEntryInput {
  sourceKey: string;
  category: string;
  title: string;
  content: string;
  intentLabel: string;
  tags: string[];
  /** FAQ question variants and natural-language aliases for retrieval. */
  aliases?: string[];
}

const EN_ENTRIES: KnowledgeEntryInput[] = [
  // ── Company Overview ────────────────────────────────────────────────────
  {
    sourceKey: 'company-overview',
    category: 'faq-general',
    title: 'About Ray Fu Enterprise and Chen Nan Iron Wire',
    content:
      'RAY FU ENTERPRISE CO., LTD. is a Taiwan-based fastener and wire trading company. ' +
      'Its parent company, CHEN NAN IRON WIRE CO., LTD., handles manufacturing. ' +
      'Main products include wire, screws, bolts, nuts, washers, and various hardware fasteners, ' +
      'supplying industrial customers worldwide. Headquartered in Kaohsiung, Taiwan.',
    intentLabel: 'general-faq',
    tags: ['company', 'Ray Fu', 'Chen Nan', 'fastener', 'wire', 'Taiwan', 'Kaohsiung', SOURCE_TAG],
  },

  // ── Wire Products ────────────────────────────────────────────────────────
  {
    sourceKey: 'wire-overview',
    category: 'product-spec',
    title: 'Wire Products Overview',
    content:
      'Chen Nan Iron Wire produces wire with a diameter range of 1.78mm to 10mm. ' +
      'Primary materials: AISI 1018–1022 and 10B21. ' +
      'Applications include manufacturing fasteners, spring wire, nails, and hardware components. ' +
      'Wire is available in three material series: Carbon Steel Wire, Alloy Steel Wire, and Stainless Steel Wire.',
    intentLabel: 'product-inquiry',
    tags: [
      'wire',
      '線材',
      'diameter',
      '1.78mm',
      '10mm',
      'AISI',
      '10B21',
      'carbon steel',
      'alloy steel',
      'stainless steel',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'wire-carbon-steel',
    category: 'product-spec',
    title: 'Carbon Steel Wire – Specifications and Applications',
    content:
      'Carbon Steel Wire covers a range from low to high carbon grades: ' +
      'AISI 1006 to AISI 1060 (or JIS SWRCH 6A to SWRCH 50K). ' +
      'Widely used for standard fasteners, springs, collated nails, and general hardware components. ' +
      'Low-carbon grades (AISI 1006–1018) offer good ductility for cold forging; ' +
      'high-carbon grades (AISI 1040–1060) provide greater strength for springs and high-strength fasteners.',
    intentLabel: 'product-inquiry',
    tags: [
      'carbon steel wire',
      '碳鋼線材',
      'AISI 1006',
      'AISI 1060',
      'SWRCH',
      'spring',
      'fastener',
      'cold forging',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'wire-alloy-steel',
    category: 'product-spec',
    title: 'Alloy Steel Wire – Specifications and Applications',
    content:
      'Alloy Steel Wire covers chromium and chromium-molybdenum grades: ' +
      'AISI 5115 to AISI 5145 (chromium steel) and JIS SCr415 to SCr445, ' +
      'as well as AISI 4120 to AISI 4150 (chromium-molybdenum steel). ' +
      'Suitable for high-strength fasteners, automotive components, and precision mechanical parts. ' +
      'Offers higher tensile strength and toughness than carbon steel.',
    intentLabel: 'product-inquiry',
    tags: [
      'alloy steel wire',
      '合金鋼線材',
      'AISI 5115',
      'AISI 4120',
      'chromium steel',
      'chromium-molybdenum',
      'high strength',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'wire-stainless-steel',
    category: 'product-spec',
    title: 'Stainless Steel Wire – Specifications and Applications',
    content:
      'Stainless Steel Wire is available in grades AISI/SAE 302 to 430, ' +
      'or corresponding JIS SUS 302 to SUS 430 standards; other standards available on request. ' +
      'Excellent corrosion resistance makes it suitable for food machinery, medical devices, ' +
      'outdoor structures, and chemical processing equipment. ' +
      'Also used as raw material for stainless steel screws, springs, and precision fasteners.',
    intentLabel: 'product-inquiry',
    tags: [
      'stainless steel wire',
      '不鏽鋼線材',
      'SUS 302',
      'SUS 430',
      'AISI 302',
      'corrosion resistance',
      'food',
      'medical',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'wire-material-selection',
    category: 'selection-guide',
    title: 'Wire Material Selection Guide',
    content:
      'When selecting wire material, evaluate these four dimensions:\n' +
      '1. Purpose: General fasteners → carbon steel; high-strength structural → alloy steel; corrosion-resistant applications → stainless steel.\n' +
      '2. Material: AISI 1018–1022 for standard fasteners; 4120–4150 series for high-strength; 302–430 series for corrosion resistance.\n' +
      '3. Size / Diameter: 1.78mm–10mm, determined by downstream fastener specifications.\n' +
      '4. Environment: Outdoor, food, chemical, or marine environments require stainless steel or special coatings.',
    intentLabel: 'product-diagnosis',
    tags: [
      'wire selection',
      'material selection',
      'carbon steel',
      'alloy steel',
      'stainless steel',
      'purpose',
      'environment',
      'diagnosis',
      SOURCE_TAG,
    ],
  },

  // ── Screws ──────────────────────────────────────────────────────────────
  {
    sourceKey: 'screw-overview',
    category: 'product-spec',
    title: 'Screws Product Overview',
    content:
      'Screw specifications range from M1.8 to M20, with lengths from 2mm to 400mm. ' +
      'Main categories include: Self-Drilling Screws, Drywall Screws, Self-Tapping Screws, ' +
      'Roofing Screws, Chipboard Screws, Collated Screws, Concrete Screws, Decking Screws, ' +
      'Wood Screws, Furniture Screws, Window Screws, Machine Screws, Stainless Steel Screws, ' +
      'Set Screws, Socket Cap Screws, SEMS Screws, and Nail Screws.',
    intentLabel: 'product-inquiry',
    tags: [
      'screw',
      '螺絲',
      'M1.8',
      'M20',
      'self-drilling',
      'drywall',
      'wood screw',
      'machine screw',
      SOURCE_TAG,
    ],
    aliases: [
      'What screw categories do you offer?',
      'What types of screws are available?',
      'What screw types do you carry?',
      'What kinds of screws do you have?',
      'screw categories',
      'screw types',
    ],
  },
  {
    sourceKey: 'screw-self-drilling',
    category: 'product-spec',
    title: 'Self-Drilling Screw',
    content:
      'Self-Drilling Screws are named for their drill-point tip, which eliminates the need for pre-drilling. ' +
      'They drill, tap, and fasten in a single operation on sheet metal or thin steel. ' +
      'Common applications include metal building panels, steel framing, equipment enclosures, and HVAC ductwork. ' +
      'Typical range: M3–M8, lengths 9mm–150mm; carbon steel (zinc plated) or stainless steel.',
    intentLabel: 'product-inquiry',
    tags: [
      'self-drilling screw',
      '鑽尾螺絲',
      'sheet metal',
      'steel frame',
      'metal building',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'screw-drywall',
    category: 'product-spec',
    title: 'Drywall Screw',
    content:
      'Drywall Screws are specifically designed for fastening gypsum boards (drywalls) to wood or metal studs. ' +
      'The fine thread bites into the stud while the bugle head countersinks flush into the board surface. ' +
      'Common sizes: M3.5–M4.8, lengths 25mm–100mm. ' +
      'Widely used in interior construction, partition walls, and ceiling installations.',
    intentLabel: 'product-inquiry',
    tags: [
      'drywall screw',
      '乾牆螺絲',
      'gypsum board',
      'partition wall',
      'interior construction',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'screw-roofing',
    category: 'product-spec',
    title: 'Roofing Screw',
    content:
      'Roofing Screws are designed for attaching roofing materials to metal or wood substrates. ' +
      'They typically include an EPDM or rubber sealing washer under the head for weatherproof performance. ' +
      'Suitable for metal roof sheeting, corrugated panels, and timber purlins. ' +
      'Typical range: M4.8–M6.3, lengths 20mm–100mm; zinc plated or stainless steel for outdoor durability.',
    intentLabel: 'product-inquiry',
    tags: [
      'roofing screw',
      '屋頂螺絲',
      'EPDM',
      'weatherproof',
      'metal roof',
      'outdoor',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'screw-wood',
    category: 'product-spec',
    title: 'Wood Screw',
    content:
      'Wood Screws are designed to fasten wood materials with coarse thread for maximum holding power. ' +
      'Common applications: furniture, flooring, timber framing, and general woodworking. ' +
      'Typical range: M2.5–M8, lengths 10mm–200mm. ' +
      'Available in carbon steel (zinc plated) and stainless steel options.',
    intentLabel: 'product-inquiry',
    tags: [
      'wood screw',
      '木螺絲',
      'furniture',
      'timber',
      'woodworking',
      'coarse thread',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'screw-concrete',
    category: 'product-spec',
    title: 'Concrete Screw',
    content:
      'Concrete Screws are used to fasten objects into concrete, masonry, or stone. ' +
      'Pre-drilling is required; the specialized thread profile provides high pull-out strength in brittle substrates. ' +
      'Typical range: M5–M10, lengths 30mm–200mm. ' +
      'Applications: factory floor anchoring, pipe supports, machinery base plates.',
    intentLabel: 'product-inquiry',
    tags: ['concrete screw', '水泥螺絲', 'masonry', 'anchoring', 'concrete', SOURCE_TAG],
  },
  {
    sourceKey: 'screw-machine',
    category: 'product-spec',
    title: 'Machine Screw',
    content:
      'Machine Screws are widely used for fastening mechanical equipment and electronic components. ' +
      'They mate with a nut or pre-tapped hole using standard metric coarse or fine threads. ' +
      'Typical range: M1.6–M12, lengths 3mm–100mm. ' +
      'Available in carbon steel, stainless steel, and brass for precision assemblies.',
    intentLabel: 'product-inquiry',
    tags: ['machine screw', '機械螺絲', 'electronics', 'metric', 'precision', SOURCE_TAG],
  },
  {
    sourceKey: 'screw-stainless',
    category: 'product-spec',
    title: 'Stainless Steel Screw',
    content:
      'Stainless Steel Screws refer to any screw type made from stainless steel material. ' +
      'Common grades: 304 (A2) and 316 (A4) — superior corrosion resistance compared to zinc-plated carbon steel. ' +
      'Suitable for marine, food processing, chemical, and medical environments. ' +
      'Available in all screw types: self-tapping, wood, machine, and more.',
    intentLabel: 'product-inquiry',
    tags: [
      'stainless steel screw',
      '不鏽鋼螺絲',
      '304',
      '316',
      'A2',
      'A4',
      'corrosion resistance',
      'marine',
      'food',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'screw-selection-guide',
    category: 'selection-guide',
    title: 'Screw Selection Guide',
    content:
      'When selecting screws, evaluate these four key dimensions:\n' +
      '1. Purpose: Sheet metal, wood, gypsum board, concrete, or precision machinery?\n' +
      '2. Material: Zinc-plated carbon steel for general use; stainless steel for outdoor or corrosive environments.\n' +
      '3. Size / Length: M1.8–M20; lengths 2mm–400mm — determined by substrate thickness and required pull-out strength.\n' +
      '4. Environment: Indoor, outdoor, humid, high-temperature, or chemically aggressive conditions each have specific recommendations.',
    intentLabel: 'product-diagnosis',
    tags: [
      'screw selection',
      '螺絲選型',
      'material',
      'size',
      'purpose',
      'environment',
      'diagnosis',
      SOURCE_TAG,
    ],
  },

  // ── Bolts ────────────────────────────────────────────────────────────────
  {
    sourceKey: 'bolt-nut-washer-overview',
    category: 'product-spec',
    title: 'Bolts, Nuts & Washers Overview',
    content:
      'Bolts, Nuts and Washers specification range: M2 to M20, strength grades 4.6 to 8.8, lengths 12mm to 120mm. ' +
      'Main applications: machinery, wind power, motorcycles, bicycles, utility poles, construction, and electronics. ' +
      'Bolt types: Hex Bolt, Flange Bolt, Carriage Bolt, Lag Bolt. ' +
      'Nut types: Hex Nut, Hex Flange Nut, Nylon Nut, Wing Nut, Square Nut, Dome Cap Nut, Cage Nut, Panel Nut.',
    intentLabel: 'product-inquiry',
    tags: [
      'bolt',
      'nut',
      'washer',
      '螺栓',
      '螺帽',
      '華司',
      'M2',
      'M20',
      'grade 4.6',
      'grade 8.8',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'bolt-hex',
    category: 'product-spec',
    title: 'Hex Bolt',
    content:
      'Hex Bolts are the most common bolt type on the market. ' +
      'The six-sided head is tightened with a wrench and used with a matching nut. ' +
      'Available in M3–M20, strength grades 4.6–8.8 (per DIN/ISO standards). ' +
      'Applications include structural steel, machinery, bridges, and industrial equipment.',
    intentLabel: 'product-inquiry',
    tags: ['hex bolt', '六角螺栓', 'DIN', 'ISO', 'structural steel', 'machinery', SOURCE_TAG],
  },
  {
    sourceKey: 'bolt-carriage',
    category: 'product-spec',
    title: 'Carriage Bolt',
    content:
      'Carriage Bolts (also called Coach Bolts) feature a rounded head with a square neck below it. ' +
      'The square neck embeds in wood to prevent rotation, allowing the nut to be tightened from the nut end only. ' +
      'Widely used in timber structures, outdoor furniture, agricultural equipment, and truck bodies.',
    intentLabel: 'product-inquiry',
    tags: [
      'carriage bolt',
      '馬車螺栓',
      'coach bolt',
      'timber',
      'outdoor furniture',
      'agricultural',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'bolt-flange',
    category: 'product-spec',
    title: 'Flange Bolt',
    content:
      'Flange Bolts differ from standard Hex Bolts by having an integrated flange (washer-like disk) under the hex head. ' +
      'The flange distributes clamping force over a wider area, protecting surfaces and providing anti-loosening properties. ' +
      'Commonly found in automotive engines, frames, and mechanical structures requiring vibration resistance.',
    intentLabel: 'product-inquiry',
    tags: [
      'flange bolt',
      '法蘭螺栓',
      'automotive',
      'vibration',
      'anti-loosening',
      'engine',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'bolt-lag',
    category: 'product-spec',
    title: 'Lag Bolt (Lag Screw)',
    content:
      'Lag Bolts (also called Lag Screws) are heavy-duty fasteners for timber. ' +
      'They feature coarse threads and a pointed tip for direct penetration into wood without a nut. ' +
      'Applications include large timber structures, heavy shelving, pallet racking, and deck construction.',
    intentLabel: 'product-inquiry',
    tags: ['lag bolt', 'lag screw', '木螺栓', 'timber', 'deck', 'heavy duty', 'wood', SOURCE_TAG],
  },

  // ── Nuts ─────────────────────────────────────────────────────────────────
  {
    sourceKey: 'nut-hex',
    category: 'product-spec',
    title: 'Hex Nut',
    content:
      'Hex Nuts are the most commonly used nuts in the market, tightened with a wrench. ' +
      'They mate with hex bolts or threaded rods per ISO/DIN standards. ' +
      'Common sizes: M3–M20. ' +
      'Used in virtually all mechanical equipment, construction structures, and industrial fastening applications.',
    intentLabel: 'product-inquiry',
    tags: ['hex nut', '六角螺帽', 'ISO', 'DIN', 'machinery', 'construction', SOURCE_TAG],
  },
  {
    sourceKey: 'nut-flange',
    category: 'product-spec',
    title: 'Hex Flange Nut',
    content:
      'Hex Flange Nuts include an integrated flange at the base of a standard hex nut. ' +
      'The flange increases the bearing surface, distributes load, and provides anti-loosening properties, ' +
      'functioning as a combined nut and washer. ' +
      'Widely used in automotive, bicycle, home appliance, and general industrial assembly.',
    intentLabel: 'product-inquiry',
    tags: [
      'hex flange nut',
      '法蘭螺帽',
      'automotive',
      'bicycle',
      'anti-loosening',
      'appliance',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'nut-nylon',
    category: 'product-spec',
    title: 'Nylon Nut (Nyloc Nut)',
    content:
      'Nylon Nuts (Nyloc Nuts) feature a nylon insert at the top of a standard hex nut. ' +
      'The nylon ring grips the thread to provide locking resistance without additional lock washers. ' +
      'Ideal for vibration and impact environments such as motorcycles and machinery. ' +
      'Operating temperature for standard nylon insert: approximately -30°C to 120°C.',
    intentLabel: 'product-inquiry',
    tags: [
      'nylon nut',
      'nyloc nut',
      '尼龍螺帽',
      'anti-loosening',
      'vibration',
      'locking',
      'motorcycle',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'nut-wing',
    category: 'product-spec',
    title: 'Wing Nut',
    content:
      'Wing Nuts are hand-tightened nuts with two wings for easy installation and removal without tools. ' +
      'Designed for applications requiring frequent assembly and disassembly. ' +
      'Common uses: lightweight fixtures, clamps, and equipment covers.',
    intentLabel: 'product-inquiry',
    tags: ['wing nut', '翼型螺帽', 'hand-tighten', 'tool-free', 'fixture', SOURCE_TAG],
  },

  // ── Washers ─────────────────────────────────────────────────────────────
  {
    sourceKey: 'washer-overview',
    category: 'product-spec',
    title: 'Washers Overview',
    content:
      'Washer product range: M2–M20 to match the bolt and nut series. ' +
      'Types available: Flat Washer, Spring Lock Washer, External Tooth Lock Washer, ' +
      'Internal Tooth Lock Washer, Umbrella Washer, and Bonding Washer (bonded washer / seal washer). ' +
      'Materials include carbon steel, stainless steel, and aluminum.',
    intentLabel: 'product-inquiry',
    tags: [
      'washer',
      '華司',
      'flat washer',
      'spring lock washer',
      'lock washer',
      'bonding washer',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'washer-flat',
    category: 'product-spec',
    title: 'Flat Washer',
    content:
      'Flat Washers are the simplest and most common washer type. ' +
      'They distribute the clamping force of a bolt or nut over a larger area, ' +
      'protecting the surface of the workpiece and bridging oversized holes. ' +
      'Available in carbon steel, stainless steel, and aluminum. ' +
      'Used in virtually all mechanical, construction, and general fastening applications.',
    intentLabel: 'product-inquiry',
    tags: [
      'flat washer',
      '平華司',
      'load distribution',
      'carbon steel',
      'stainless steel',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'washer-spring-lock',
    category: 'product-spec',
    title: 'Spring Lock Washer',
    content:
      'Spring Lock Washers are split-ring washers that use spring tension to resist loosening. ' +
      'Unlike flat washers, they provide anti-vibration and anti-loosening properties ' +
      'through elastic deformation when compressed. ' +
      'Commonly used with hex bolts and hex nuts in machinery, power tools, and automotive applications.',
    intentLabel: 'product-inquiry',
    tags: [
      'spring lock washer',
      '彈簧華司',
      'anti-loosening',
      'vibration',
      'machinery',
      'automotive',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'washer-bonding',
    category: 'product-spec',
    title: 'Bonding Washer (Bonded Washer)',
    content:
      'Bonding Washers (also called Bonded Washers) are a combination of a flat metal washer and a rubber sealing element. ' +
      'They provide both mechanical load distribution and weatherproof sealing in one part. ' +
      'Commonly used with roofing screws, outdoor enclosures, and any application requiring a watertight seal.',
    intentLabel: 'product-inquiry',
    tags: [
      'bonding washer',
      'bonded washer',
      '複合華司',
      'seal',
      'weatherproof',
      'roofing',
      SOURCE_TAG,
    ],
  },

  // ── Other Products ───────────────────────────────────────────────────────
  {
    sourceKey: 'other-nail',
    category: 'product-spec',
    title: 'Other Products: Nail',
    content:
      'Nails are pin-shaped fasteners made mostly from carbon steel, used primarily in woodworking. ' +
      'Types include common round nails, spiral (twisted) nails for improved holding power, ' +
      'and ring-shank nails for permanent fixing. ' +
      'Applications include timber structures, construction, pallet manufacturing, and flooring.',
    intentLabel: 'product-inquiry',
    tags: ['nail', '釘子', 'carbon steel', 'woodworking', 'spiral nail', 'ring shank', SOURCE_TAG],
  },
  {
    sourceKey: 'other-rivet',
    category: 'product-spec',
    title: 'Other Products: Rivet',
    content:
      'Rivets are permanent fasteners used to join two or more workpieces together. ' +
      'Types include pop rivets (blind rivets) for one-side access, and solid rivets for structural joints. ' +
      'Applications include sheet metal assembly, structural components, and tamper-resistant connections.',
    intentLabel: 'product-inquiry',
    tags: [
      'rivet',
      '鉚釘',
      'blind rivet',
      'pop rivet',
      'sheet metal',
      'permanent fastener',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'other-hose-clamp',
    category: 'product-spec',
    title: 'Other Products: Hose Clamp',
    content:
      'Hose Clamps are specialty fasteners designed to secure a hose connection to a fitting, ' +
      'providing a leak-proof seal. ' +
      'Widely used in automotive cooling systems, industrial piping, and agricultural irrigation. ' +
      'Available in various sizes and materials including stainless steel for corrosion resistance.',
    intentLabel: 'product-inquiry',
    tags: [
      'hose clamp',
      '管夾',
      'hose fitting',
      'leak-proof',
      'automotive',
      'piping',
      'stainless steel',
      SOURCE_TAG,
    ],
  },

  // ── FAQ ──────────────────────────────────────────────────────────────────
  {
    sourceKey: 'contact-inquiry',
    category: 'faq-general',
    title: 'How to Contact Us and Request a Quote',
    content:
      'RAY FU ENTERPRISE CO., LTD. (Trading Office): ' +
      '23F-1, No. 366, Bo-ai 2nd Rd., Zuoying District, Kaohsiung City 813623, Taiwan. ' +
      'Tel: +886-7-556-0180 | Fax: +886-7-556-0174 | E-mail: export@ray-fu.com | Web: www.ray-fu.com\n\n' +
      'CHEN NAN IRON WIRE CO., LTD. (Plant & Laboratory): ' +
      'No. 202, Lane 275, Shun-an Rd., Luzhu District, Kaohsiung City 821010, Taiwan. ' +
      'Tel: +886-7-697-5852 | Fax: +886-7-697-5854 | E-mail: export@chen-nan.com.tw\n\n' +
      'For inquiries, please contact us via the website form, e-mail, or phone with your specifications and required quantities.',
    intentLabel: 'general-faq',
    tags: [
      'contact',
      'inquiry',
      'quote',
      'phone',
      'email',
      'export@ray-fu.com',
      'Kaohsiung',
      SOURCE_TAG,
    ],
    aliases: [
      'How can I contact you?',
      'How do I request a quote?',
      'How do I get a price quote?',
      'How can I get a quotation?',
      'contact information',
      'request a quote',
      'get in touch',
      'where is your office?',
    ],
  },
  {
    sourceKey: 'catalog-download',
    category: 'faq-general',
    title: 'Product Catalog Download',
    content:
      'Ray Fu Enterprise provides the following downloadable product catalogs: ' +
      '1. Main Products catalog; ' +
      '2. Ray Fu Catalogue-1; ' +
      '3. Ray Fu Catalogue-2; ' +
      '4. Ray Fu 2019 catalog. ' +
      'All catalogs are available on the products page at https://www.ray-fu.com/products. ' +
      'For the latest version, you may also contact our sales team directly.',
    intentLabel: 'general-faq',
    tags: ['catalog', 'catalogue', '型錄', 'download', 'PDF', 'brochure', SOURCE_TAG],
    aliases: [
      'How can I download the product catalog?',
      'Where can I download the catalog?',
      'How do I get the brochure?',
      'Where is the product catalog?',
      'download product catalog',
      'download brochure',
      'product catalogue download',
    ],
  },
  {
    sourceKey: 'product-range',
    category: 'faq-general',
    title: 'Product Range and Available Categories',
    content:
      'Ray Fu / Chen Nan can supply the following product categories: ' +
      'Wire, Screws, Bolts, Nuts, Washers, Nails, Rivets, Hose Clamps, ' +
      'and Specialty / custom-specification products. ' +
      'All products can be quoted upon request. For special specifications, please contact us with your requirements.',
    intentLabel: 'general-faq',
    tags: [
      'product range',
      'supply',
      'wire',
      'screw',
      'bolt',
      'nut',
      'washer',
      'nail',
      'rivet',
      'specialty',
      SOURCE_TAG,
    ],
  },

  // ── Selection Guides (Phase 4 Diagnosis Support) ─────────────────────────
  {
    sourceKey: 'fastener-selection-guide',
    category: 'selection-guide',
    title: 'Fastener Selection Guide',
    content:
      'Before selecting a fastener, clarify these four key dimensions (diagnosis questions):\n' +
      '1. Purpose: Is it for structural fixing, anti-loosening, waterproofing, or grounding?\n' +
      '2. Material: Carbon steel (general), alloy steel (high strength), stainless steel (corrosion resistant), brass (conductive).\n' +
      '3. Size / Diameter: Metric bolts M2–M20; screws M1.8–M20; lengths 2–400mm available.\n' +
      '4. Environment: Indoor, outdoor, humid, high-salinity, high-temperature, or vibration conditions?\n' +
      'Narrowing down these four dimensions helps identify the optimal fastener type and material.',
    intentLabel: 'product-diagnosis',
    tags: [
      'fastener selection',
      '選型',
      'purpose',
      'material',
      'size',
      'diameter',
      'environment',
      'diagnosis',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'fastener-material-by-env',
    category: 'selection-guide',
    title: 'Material Recommendations by Environment',
    content:
      'Material selection by use environment (based on publicly available information):\n' +
      '- General indoor: Zinc-plated carbon steel — cost-effective for most applications.\n' +
      '- General outdoor: Zinc-plated or powder-coated carbon steel for improved longevity.\n' +
      '- Coastal / high-salt: Grade 304 or 316 stainless steel recommended for strong salt-spray resistance.\n' +
      '- Food / medical: 316 stainless steel to meet hygiene requirements.\n' +
      '- High-vibration: Pair with nylon lock nuts or spring lock washers for anti-loosening.\n' +
      '- High-temperature (>200°C): Special alloys required — please consult our sales team.',
    intentLabel: 'product-diagnosis',
    tags: [
      'environment',
      'material',
      'stainless steel',
      'carbon steel',
      'zinc plated',
      'corrosion',
      'vibration',
      'diagnosis',
      SOURCE_TAG,
    ],
  },
  {
    sourceKey: 'fastener-by-application',
    category: 'selection-guide',
    title: 'Industrial Application Scenarios and Recommended Fasteners',
    content:
      'Recommended products by industrial application (based on official website information):\n' +
      '- Machinery: Hex bolts (M5–M20, grade 8.8) + hex nuts + flat washers; machine screws for precision assembly.\n' +
      '- Wind Power: High-strength bolts (grade 8.8+) + flange nuts for strict anti-loosening requirements.\n' +
      '- Motorcycles / Vehicles: Flange bolts + flange nuts (anti-loosening); nylon nuts for vibrating engine parts.\n' +
      '- Bicycles: M4–M10 bolts and screws; stainless steel preferred for outdoor use.\n' +
      '- Construction / Steel Structure: Hex bolts (grades 4.6–8.8) + large flat washers.\n' +
      '- Electronics: Small machine screws (M1.6–M4); cage nuts and panel nuts for rack mounting.\n' +
      '- Timber / Wood Structures: Wood screws, carriage bolts, lag bolts.',
    intentLabel: 'product-diagnosis',
    tags: [
      'application',
      'industrial',
      'machinery',
      'wind power',
      'automotive',
      'bicycle',
      'construction',
      'electronics',
      'timber',
      'diagnosis',
      SOURCE_TAG,
    ],
  },
];

/**
 * Seed public English knowledge entries.
 * Idempotent — upserts by sourceKey+language; backfills any legacy entries that lack a sourceKey.
 */
export async function seedKnowledgePublicEn(prisma: PrismaClient): Promise<void> {
  console.log('  Seeding KnowledgeEntry (public-en)...');
  const language = 'en';
  let upserted = 0;

  for (const entry of EN_ENTRIES) {
    // Backfill: update any existing entry with the same title+language that lacks a sourceKey
    await prisma.knowledgeEntry.updateMany({
      where: { title: entry.title, language, sourceKey: null },
      data: { sourceKey: entry.sourceKey, category: entry.category, answerType: 'rag' },
    });

    await prisma.knowledgeEntry.upsert({
      where: { sourceKey_language: { sourceKey: entry.sourceKey, language } },
      update: {
        title: entry.title,
        content: entry.content,
        intentLabel: entry.intentLabel,
        tags: entry.tags,
        aliases: entry.aliases ?? [],
        category: entry.category,
        answerType: 'rag',
      },
      create: {
        sourceKey: entry.sourceKey,
        title: entry.title,
        content: entry.content,
        intentLabel: entry.intentLabel,
        tags: entry.tags,
        aliases: entry.aliases ?? [],
        category: entry.category,
        answerType: 'rag',
        status: 'approved',
        visibility: 'public',
        version: 1,
        language,
      },
    });
    upserted++;
  }

  console.log(`  KnowledgeEntry (public-en): ${upserted} entries upserted`);
}
