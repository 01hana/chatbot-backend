import { IsOptional, Matches } from 'class-validator';

/**
 * Optional query parameters for GET /api/v1/admin/dashboard.
 *
 * No params required — omitting all params returns stats for the current month.
 *
 * month?: YYYY-MM — optional override for the statistics month.
 *   Returns 400 when present but in wrong format.
 */
export class DashboardQueryDto {
  /**
   * Target month in YYYY-MM format.
   * When absent, defaults to the server's current calendar month.
   */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month must be a valid YYYY-MM string (e.g. 2026-01)',
  })
  month?: string;
}
