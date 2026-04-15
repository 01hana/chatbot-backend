/**
 * intent-templates.seed.ts — Phase 1 T1-004
 *
 * Seeds initial IntentTemplate rows.  Follow-up question templates use
 * conservative defaults (OQ-003); the client can refine them through the
 * Admin API after go-live without requiring a code deployment.
 */
import { PrismaClient } from '../../src/generated/prisma/client';

const INTENT_TEMPLATES: {
  intent: string;
  label: string;
  keywords: string[];
  templateZh: string;
  templateEn: string;
  priority: number;
}[] = [
  {
    intent: 'product-inquiry',
    label: '產品詢問',
    keywords: ['產品', '型號', '規格', '尺寸', '材質', 'product', 'model', 'spec', 'size'],
    templateZh: '您好！請問您想了解哪項產品？可以提供型號或用途，我會為您查詢詳細資訊。',
    templateEn: 'Hi! Which product are you interested in? Please share the model number or use case so I can look up the details for you.',
    priority: 10,
  },
  {
    intent: 'product-diagnosis',
    label: '產品問診',
    keywords: ['問題', '故障', '異常', '壞掉', '不正常', '修', 'issue', 'broken', 'fault', 'problem', 'repair'],
    templateZh: '了解您遇到的狀況。為了幫您精準判斷，請問：\n1. 使用的產品型號是？\n2. 問題是什麼時候開始出現的？\n3. 使用環境（溫度、濕度）大約是？',
    templateEn: 'I understand you are having an issue. To help diagnose accurately, could you tell me:\n1. What is the product model?\n2. When did the issue first occur?\n3. What is the operating environment (temperature, humidity)?',
    priority: 20,
  },
  {
    intent: 'price-inquiry',
    label: '價格詢問',
    keywords: ['價格', '報價', '多少錢', '費用', '優惠', 'price', 'quote', 'cost', 'discount', 'how much'],
    templateZh: '感謝您的詢價。請問您需要報價的產品型號與數量是？我會協助您取得最新報價。',
    templateEn: 'Thank you for your inquiry. Could you share the product model and quantity you need a quote for? I will help you get the latest pricing.',
    priority: 15,
  },
  {
    intent: 'general-faq',
    label: '常見問題',
    keywords: ['如何', '怎麼', '什麼是', '說明', 'FAQ', 'how to', 'what is', 'explain', 'help'],
    templateZh: '您好！請問有什麼我可以協助您的嗎？',
    templateEn: 'Hello! How can I assist you today?',
    priority: 0,
  },
];

export async function seedIntentTemplates(prisma: PrismaClient): Promise<void> {
  console.log('  Seeding IntentTemplate...');
  let upserted = 0;

  for (const template of INTENT_TEMPLATES) {
    await prisma.intentTemplate.upsert({
      where: { intent: template.intent },
      update: {
        label: template.label,
        keywords: template.keywords,
        templateZh: template.templateZh,
        templateEn: template.templateEn,
        priority: template.priority,
      },
      create: template,
    });
    upserted++;
  }

  console.log(`  IntentTemplate: ${upserted} entries upserted`);
}
