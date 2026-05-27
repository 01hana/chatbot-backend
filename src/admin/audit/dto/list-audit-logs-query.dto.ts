import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const SORT_FIELDS = [
  'createdAt',
  'eventType',
  'totalTokens',
  'durationMs',
] as const;

/**
 * Query parameters for GET /api/v1/admin/audit-logs.
 * All fields optional — defaults: page=1, pageSize=20, sortBy=createdAt desc.
 */
export class ListAuditLogsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  /** Exact match on requestId (X-Request-ID header). */
  @IsOptional()
  @IsString()
  requestId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
