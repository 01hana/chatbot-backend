import { Injectable } from '@nestjs/common';
import type { Conversation, ConversationMessage } from '../generated/prisma/client';
import { ConversationService } from '../conversation/conversation.service';
import { IntentService } from '../intent/intent.service';
import type { HighIntentResult } from '../intent/types/intent-detect-result.type';
import { SystemConfigService } from '../system-config/system-config.service';

export interface LeadPromptEnrichInput {
  conversation: Conversation;
  history: ConversationMessage[];
  userMessage: string;
  assistantContent: string;
  language: string;
  intentLabel: string | null;
}

export interface LeadPromptEnrichResult {
  content: string;
  leadPrompted: boolean;
  highIntentResult: HighIntentResult;
}

@Injectable()
export class LeadPromptEnricherService {
  constructor(
    private readonly intentService: IntentService,
    private readonly systemConfigService: SystemConfigService,
    private readonly conversationService: ConversationService,
  ) {}

  async enrich(input: LeadPromptEnrichInput): Promise<LeadPromptEnrichResult> {
    const highIntentResult = this.intentService.isHighIntent([
      ...input.history,
      { role: 'user', content: input.userMessage },
      { role: 'assistant', content: input.assistantContent },
    ]);

    const leadPrompted =
      highIntentResult.isHighIntent || input.intentLabel === 'price-inquiry';
    const content = leadPrompted
      ? `${input.assistantContent}\n\n${this.getLeadPromptText(input.language)}`
      : input.assistantContent;

    await this.conversationService.updateConversation(input.conversation.sessionId, {
      highIntentScore: highIntentResult.score,
    });

    return { content, leadPrompted, highIntentResult };
  }

  private getLeadPromptText(language: string): string {
    const zhFallback =
      '如果您願意，也可以留下姓名、Email、公司與需求，我們的業務人員會協助您確認更精準的規格與報價。';
    const enFallback =
      'You may also leave your name, email, company, and requirements so our sales team can help confirm the suitable specifications and quotation.';

    const zhConfig = this.systemConfigService.get('lead_prompt_text_zh');
    const enConfig = this.systemConfigService.get('lead_prompt_text_en');

    if (language === 'en') {
      return typeof enConfig === 'string' && enConfig.trim() !== ''
        ? enConfig
        : enFallback;
    }

    return typeof zhConfig === 'string' && zhConfig.trim() !== ''
      ? zhConfig
      : zhFallback;
  }
}