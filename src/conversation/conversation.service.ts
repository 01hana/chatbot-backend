import { Injectable } from '@nestjs/common';
import { Conversation, ConversationMessage } from '../generated/prisma/client';
import { ConversationRepository } from './conversation.repository';
import { CreateSessionResult } from './types/conversation.types';

/**
 * ConversationService — application-layer façade over ConversationRepository.
 *
 * All pipeline and controller code must go through this service, never the
 * repository directly (enforces a single point of business logic).
 */
@Injectable()
export class ConversationService {
  constructor(private readonly conversationRepository: ConversationRepository) {}

  /**
   * Create a new chat session.
   * Returns only the external `sessionToken` — the internal sessionId is
   * never exposed to the frontend.
   */
  async createSession(language?: string): Promise<CreateSessionResult> {
    const conversation = await this.conversationRepository.createSession(language);
    return {
      sessionToken: conversation.session_token,
      createdAt: conversation.createdAt,
    };
  }

  /**
   * Look up a Conversation by its external sessionToken.
   * Returns null when the session does not exist.
   */
  async findBySessionToken(token: string): Promise<Conversation | null> {
    return this.conversationRepository.findBySessionToken(token);
  }

  /**
   * Look up a Conversation by its internal sessionId.
   */
  async findById(sessionId: string): Promise<Conversation | null> {
    return this.conversationRepository.findById(sessionId);
  }

  /**
   * Append a user or assistant message to an existing conversation.
   */
  async addMessage(
    conversationId: number,
    data: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      type?: string;
      riskLevel?: string;
      blockedReason?: string;
    },
  ): Promise<ConversationMessage> {
    return this.conversationRepository.addMessage(conversationId, data);
  }

  /**
   * Retrieve the message history for a session (by sessionToken).
   * Returns an empty array when the session is not found.
   */
  async getHistoryByToken(sessionToken: string, limit = 50): Promise<ConversationMessage[]> {
    const conversation = await this.conversationRepository.findBySessionToken(sessionToken);
    if (!conversation) return [];
    return this.conversationRepository.getHistory(conversation.sessionId, limit);
  }

  /**
   * Atomically increment `sensitiveIntentCount` by 1 for the given session.
   * Returns the updated Conversation (with the new count visible).
   */
  async incrementSensitiveIntentCount(sessionId: string): Promise<Conversation> {
    return this.conversationRepository.incrementSensitiveIntentCount(sessionId);
  }

  /**
   * Partially update a Conversation.
   */
  async updateConversation(
    sessionId: string,
    data: Partial<
      Pick<
        Conversation,
        'status' | 'type' | 'riskLevel' | 'sensitiveIntentCount' | 'highIntentScore' | 'diagnosisContext' | 'language'
      >
    >,
  ): Promise<Conversation> {
    return this.conversationRepository.updateConversation(sessionId, data);
  }
}
