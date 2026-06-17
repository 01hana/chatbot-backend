import { IsString, IsNotEmpty, IsArray, IsOptional, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import type { KnowledgeEntry, KnowledgeVersion } from '../../../generated/prisma/client';
import type { KnowledgeCategoryOptionVm } from '../../../knowledge-category/knowledge-category.repository';

/** Valid language codes for knowledge entries. */
const SUPPORTED_LANGUAGES = ['zh-TW', 'en'] as const;

/** Valid status values for knowledge entries. */
export const KNOWLEDGE_STATUSES = ['draft', 'published', 'archived'] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export interface FilterOption<TValue extends string = string> {
  label: string;
  value: TValue;
}

export interface KnowledgeFilterOptionsResponse {
  status: FilterOption<KnowledgeStatus>[];
  category: KnowledgeCategoryOptionVm[];
}

export type RetrievalBlockReason =
  | 'status_not_published'
  | 'visibility_not_public'
  | 'deleted'
  | 'intentLabel_missing'
  | 'tags_empty'
  | 'content_empty';

export interface KnowledgeRetrievalState {
  retrievable: boolean;
  retrievalBlockReasons: RetrievalBlockReason[];
}

export type AdminKnowledgeEntryVm = KnowledgeEntry & KnowledgeRetrievalState;
export type AdminKnowledgeEntryDetailVm = KnowledgeEntry & {
  versions: KnowledgeVersion[];
} & KnowledgeRetrievalState;

/** Valid visibility values for knowledge entries. */
export const KNOWLEDGE_VISIBILITIES = ['public', 'private', 'internal', 'confidential'] as const;

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

  @IsOptional()
  @IsString()
  sourceKey?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  @IsIn(['template', 'rag+template', 'rag', 'llm'])
  answerType?: string;

  @IsOptional()
  @IsString()
  templateKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  faqQuestions?: string[];

  @IsOptional()
  @IsString()
  crossLanguageGroupKey?: string;

  /**
   * Visibility of the entry. Retrieval only returns entries with visibility='public'.
   * Defaults to 'private' when omitted.
   */
  @IsOptional()
  @IsString()
  @IsIn([...KNOWLEDGE_VISIBILITIES])
  visibility?: string;

  // TODO: structuredAttributes admin editing deferred — field captured in version snapshots but not yet editable via Admin API.
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
  @IsIn([...KNOWLEDGE_VISIBILITIES])
  visibility?: string;

  @IsOptional()
  @IsString()
  sourceKey?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  @IsIn(['template', 'rag+template', 'rag', 'llm'])
  answerType?: string;

  @IsOptional()
  @IsString()
  templateKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  faqQuestions?: string[];

  @IsOptional()
  @IsString()
  crossLanguageGroupKey?: string;

  // TODO: structuredAttributes admin editing deferred — field captured in version snapshots but not yet editable via Admin API.
}

/** DTO for updating only knowledge entry visibility via the dedicated endpoint. */
export class UpdateKnowledgeVisibilityDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([...KNOWLEDGE_VISIBILITIES])
  visibility!: string;
}

/** Allowed sort fields for knowledge entry list. */
const ALLOWED_KNOWLEDGE_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'title',
  'version',
  'status',
] as const;

/** DTO for listing knowledge entries with pagination and filters (GET /admin/knowledge). */
export class ListKnowledgeQueryDto {
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
  @IsIn([...KNOWLEDGE_STATUSES])
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn([...KNOWLEDGE_VISIBILITIES])
  visibility?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  intentLabel?: string;

  @IsOptional()
  @IsString()
  sourceKey?: string;

  @IsOptional()
  @IsString()
  @IsIn([...ALLOWED_KNOWLEDGE_SORT_FIELDS])
  sortBy?: string;

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: string;
}
