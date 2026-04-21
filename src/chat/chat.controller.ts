import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConversationService } from '../conversation/conversation.service';
import { ChatPipelineService } from './chat-pipeline.service';
import { CreateSessionDto, HandoffDto, SendMessageDto } from './dto/chat.dto';

/**
 * ChatController — Chat API endpoints.
 *
 * All routes use `sessionToken` (the external UUID).
 * The internal `sessionId` is NEVER exposed in any response.
 *
 * Routes:
 *  POST   /api/v1/chat/sessions                              → create session
 *  POST   /api/v1/chat/sessions/:sessionToken/messages       → send message (SSE)
 *  GET    /api/v1/chat/sessions/:sessionToken/history        → message history
 *  POST   /api/v1/chat/sessions/:sessionToken/handoff        → request handoff
 *
 * NOTE on SSE endpoint:
 *  The `@Res()` decorator opts this handler out of NestJS's response lifecycle
 *  (TransformInterceptor, GlobalExceptionFilter). The handler writes directly
 *  to the Express response object to enable streaming.
 */
@Controller('chat')
export class ChatController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly chatPipeline: ChatPipelineService,
  ) {}

  // ─── Create Session ───────────────────────────────────────────────────────

  /**
   * POST /api/v1/chat/sessions
   *
   * Creates a new chat session and returns the external `sessionToken`.
   * The frontend must store this token and include it in all subsequent calls.
   */
  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(@Body() dto: CreateSessionDto) {
    const result = await this.conversationService.createSession(dto.language);
    return {
      sessionToken: result.sessionToken,
      createdAt: result.createdAt,
    };
  }

  // ─── Send Message (SSE stream) ────────────────────────────────────────────

  /**
   * POST /api/v1/chat/sessions/:sessionToken/messages
   *
   * Sends a user message and streams the AI response via SSE.
   *
   * SSE events:
   *   event: token\ndata: {"token":"..."}\n\n
   *   event: done\ndata: {messageId, action, intentLabel, sourceReferences, usage}\n\n
   *   event: error\ndata: {code, message}\n\n
   *   event: timeout\ndata: {message}\n\n
   *   event: interrupted\ndata: {message}\n\n
   *
   * `done` event payload example:
   *   {
   *     "messageId": 42,
   *     "action": "answer",
   *     "intentLabel": "product-inquiry",
   *     "sourceReferences": [1, 3],
   *     "usage": { "promptTokens": 123, "completionTokens": 45, "totalTokens": 168 }
   *   }
   *
   * `intentLabel` is null when no intent was matched, or when the pipeline was
   * short-circuited before intent detection (safety guard / confidentiality block).
   * It is never undefined — always a string or null.
   *
   * Client disconnection is detected via `res.on('close')` → AbortController.abort().
   * There is NO separate cancel endpoint — AbortController is the cancellation mechanism.
   */
  @Post('sessions/:sessionToken/messages')
  async sendMessage(
    @Param('sessionToken') sessionToken: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request & { requestId?: string },
    @Res() res: Response,
  ): Promise<void> {
    const conversation = await this.conversationService.findBySessionToken(sessionToken);
    if (!conversation) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Session not found' });
      return;
    }

    const abortController = new AbortController();
    res.on('close', () => abortController.abort());

    const requestId = req.requestId ?? (req.headers['x-request-id'] as string) ?? '';

    await this.chatPipeline.run(conversation, dto.message, requestId, res, abortController.signal);
  }

  // ─── Message History ──────────────────────────────────────────────────────

  /**
   * GET /api/v1/chat/sessions/:sessionToken/history
   *
   * Returns the conversation message history for the given session.
   * Returned in ascending chronological order.
   */
  @Get('sessions/:sessionToken/history')
  async getHistory(@Param('sessionToken') sessionToken: string) {
    const conversation = await this.conversationService.findBySessionToken(sessionToken);
    if (!conversation) {
      throw new NotFoundException('Session not found');
    }

    const messages = await this.conversationService.getHistoryByToken(sessionToken);
    return {
      sessionToken,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        type: m.type,
        createdAt: m.createdAt,
      })),
    };
  }

  // ─── Handoff ──────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/chat/sessions/:sessionToken/handoff
   *
   * Visitor explicitly requests human hand-off.
   *
   * Contract (task.md §0 + T2-008):
   *   { accepted, action: "handoff", leadId, ticketId, message }
   *   When `accepted = true`, `leadId` and `ticketId` must not BOTH be null.
   *
   * Phase 2 — Phase 5 stub:
   *   Lead and Ticket creation is deferred to Phase 5 (T5-002/T5-003).
   *   `accepted: false` with null ids is the correct Phase-2 response given
   *   that no Lead/Ticket module exists yet. The frontend must handle
   *   `accepted: false` by showing a contact form.
   *
   * TODO(T5-002/T5-003): inject LeadService + TicketService, create Lead and
   *   Ticket rows, return `accepted: true` with actual `leadId` / `ticketId`.
   */
  @Post('sessions/:sessionToken/handoff')
  @HttpCode(HttpStatus.OK)
  async handoff(
    @Param('sessionToken') sessionToken: string,
    @Body() _dto: HandoffDto,
  ) {
    const conversation = await this.conversationService.findBySessionToken(sessionToken);
    if (!conversation) {
      throw new NotFoundException('Session not found');
    }

    // Phase 2: Lead/Ticket creation pending Phase 5 (T5-002/T5-003).
    // accepted=false is the correct response while no Lead/Ticket module exists.
    return {
      accepted: false,
      action: 'handoff' as const,
      leadId: null as string | null,
      ticketId: null as string | null,
      message: '您的轉接請求已收到。我們的業務人員將儘速與您聯繫。',
    };
  }
}
