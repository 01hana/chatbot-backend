import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

const INTENT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'intent',
  'label',
  'priority',
  'category',
  'isActive',
] as const;

/** DTO for creating an IntentTemplate via the admin API. */
export class CreateIntentTemplateDto {
  /** Unique machine-readable intent key (e.g. "product-inquiry"). */
  @IsString()
  @IsNotEmpty()
  intent!: string;

  /** Human-readable display label. */
  @IsString()
  @IsNotEmpty()
  label!: string;

  /** Keyword hints used for keyword-based detection. */
  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  /** Follow-up question template (Traditional Chinese). */
  @IsString()
  @IsNotEmpty()
  templateZh!: string;

  /** Follow-up question template (English). */
  @IsString()
  @IsNotEmpty()
  templateEn!: string;

  /** Detection priority — higher value is evaluated first. Defaults to 0. */
  @IsNumber()
  @IsOptional()
  priority?: number;

  /** Product / topic category for routing (e.g. "product-spec", "faq-general"). */
  @IsString()
  @IsOptional()
  category?: string;
}

/** DTO for partially updating an IntentTemplate via the admin API. */
export class UpdateIntentTemplateDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  label?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  keywords?: string[];

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  templateZh?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  templateEn?: string;

  @IsNumber()
  @IsOptional()
  priority?: number;

  @IsString()
  @IsOptional()
  category?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/** DTO for listing IntentTemplate rows with pagination and filters. */
export class ListIntentTemplateQueryDto {
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

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  @IsIn(['true', 'false'])
  isActive?: string;

  @IsOptional()
  @IsString()
  @IsIn([...INTENT_SORT_FIELDS])
  sortBy?: string;

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: string;
}
