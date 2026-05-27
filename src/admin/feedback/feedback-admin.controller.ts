import { Controller, Get, Query } from '@nestjs/common';
import { FeedbackAdminService, FeedbackListResult } from './feedback-admin.service';
import { ListFeedbackQueryDto } from './dto/list-feedback-query.dto';

/**
 * FeedbackAdminController — admin read endpoint for feedback rows.
 *
 * Routes (all under /api/v1 global prefix):
 *   GET  /admin/feedback   → paginated list with filters
 */
@Controller('admin/feedback')
export class FeedbackAdminController {
  constructor(private readonly service: FeedbackAdminService) {}

  /** GET /api/v1/admin/feedback */
  @Get()
  list(@Query() query: ListFeedbackQueryDto): Promise<FeedbackListResult> {
    return this.service.list(query);
  }
}
