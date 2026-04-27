import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsNumber,
  IsBoolean,
} from 'class-validator';

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
