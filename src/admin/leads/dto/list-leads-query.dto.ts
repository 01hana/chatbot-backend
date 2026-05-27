import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'closed'] as const;
const SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'email', 'status'] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

/**
 * Query parameters for GET /api/v1/admin/leads.
 * All fields optional — defaults: page=1, pageSize=20, sortBy=createdAt desc.
 */
export class ListLeadsQueryDto {
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

  /** Full-text search across name, email, company, and message. */
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: string;

  /**
   * Notification dispatch status filter.
   * Schema stores this as a free String (default 'pending').
   * Candidate values are: pending | success | failed.
   * TODO: convert to @IsIn once NotificationJob slice is implemented and
   *       the schema column is migrated to an enum.
   */
  @IsOptional()
  @IsString()
  notificationStatus?: string;

  @IsOptional()
  @IsString()
  type?: string;

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
  @IsIn(SORT_ORDERS)
  sortOrder?: string;
}
