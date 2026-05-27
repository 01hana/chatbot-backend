import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Body,
} from '@nestjs/common';
import {
  ConversationsAdminService,
  ConversationListResult,
  ConversationDetailVm,
  ConversationExportResult,
} from './conversations-admin.service';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';

/**
 * ConversationsAdminController — admin read endpoints for conversations.
 *
 * Routes (all under /api/v1 global prefix):
 *   GET  /admin/conversations            → paginated list with filters
 *   GET  /admin/conversations/:id        → full conversation detail
 *   POST /admin/conversations/export     → CSV export (base64 data URL)
 */
@Controller('admin/conversations')
export class ConversationsAdminController {
  constructor(private readonly service: ConversationsAdminService) {}

  /** GET /api/v1/admin/conversations */
  @Get()
  list(@Query() query: ListConversationsQueryDto): Promise<ConversationListResult> {
    return this.service.list(query);
  }

  /** POST /api/v1/admin/conversations/export */
  @Post('export')
  @HttpCode(HttpStatus.OK)
  export(
    @Body() body: ListConversationsQueryDto,
  ): Promise<ConversationExportResult> {
    return this.service.export(body);
  }

  /** GET /api/v1/admin/conversations/:id */
  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ConversationDetailVm> {
    return this.service.findOne(id);
  }
}
