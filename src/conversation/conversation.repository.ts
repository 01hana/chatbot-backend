import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Conversation, ConversationMessage } from '../generated/prisma/client';

/**
 * ConversationRepository — data-access layer for conversations and
 * conversation_messages tables.
 *
 * All Chat API routes use `sessionToken` (the external UUID). The repository
 * translates between `session_token` and the internal `sessionId`.
 */
@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Session Management ───────────────────────────────────────────────────

  /**
   * Create a new Conversation row.
   * `session_token` and `sessionId` are auto-generated UUIDs by Prisma default.
   */
  async createSession(language = 'zh-TW'): Promise<Conversation> {
    return this.prisma.conversation.create({
      data: { language },
    });
  }

  /**
   * Find a Conversation by its internal sessionId.
   */
  async findById(sessionId: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({
      where: { sessionId },
    });
  }

  /**
   * Find a Conversation by the external sessionToken (session_token).
   * This is the primary lookup used by all Chat API endpoints.
   */
  async findBySessionToken(token: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({
      where: { session_token: token },
    });
  }

  /**
   * Append a new message to an existing Conversation.
   *
   * @param conversationId - The PK of the Conversation row.
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
    return this.prisma.conversationMessage.create({
      data: {
        conversationId,
        role: data.role,
        content: data.content,
        type: data.type ?? 'normal',
        riskLevel: data.riskLevel ?? null,
        blockedReason: data.blockedReason ?? null,
      },
    });
  }

  /**
   * Fetch the most recent messages for a session (ascending order).
   *
   * @param sessionId - Internal Conversation.sessionId
   * @param limit     - Maximum number of messages to return (default 50)
   */
  async getHistory(sessionId: string, limit = 50): Promise<ConversationMessage[]> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { sessionId },
      select: { id: true },
    });
    if (!conversation) return [];

    return this.prisma.conversationMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Partially update a Conversation row.
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
    return this.prisma.conversation.update({
      where: { sessionId },
      data: data as Prisma.ConversationUpdateInput,
    });
  }
}
