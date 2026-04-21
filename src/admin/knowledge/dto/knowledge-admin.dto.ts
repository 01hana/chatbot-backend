import { IsString, IsNotEmpty, IsArray, IsOptional, IsIn } from 'class-validator';

/** Valid language codes for knowledge entries. */
const SUPPORTED_LANGUAGES = ['zh-TW', 'en'] as const;

/** DTO for creating a knowledge entry via the admin API. */
export class CreateKnowledgeDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsString()
  @IsOptional()
  intentLabel?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  /**
   * FAQ question variants and natural-language aliases for retrieval.
   * Storing common user phrasings here enables FAQ-friendly ILIKE retrieval.
   * Do NOT put product keywords here — use `tags` for those.
   */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  aliases?: string[];

  /**
   * ISO language tag for this entry — used for language-aware retrieval.
   * Valid values: 'zh-TW' | 'en'. Defaults to 'zh-TW' if omitted.
   */
  @IsString()
  @IsIn(SUPPORTED_LANGUAGES)
  @IsOptional()
  language?: string;
}

/** DTO for updating an existing knowledge entry. */
export class UpdateKnowledgeDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  title?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  intentLabel?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  /**
   * FAQ question variants and natural-language aliases for retrieval.
   * Replaces the entire aliases array when provided.
   */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  aliases?: string[];

  /**
   * ISO language tag — 'zh-TW' | 'en'.
   */
  @IsString()
  @IsIn(SUPPORTED_LANGUAGES)
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  visibility?: string;
}
