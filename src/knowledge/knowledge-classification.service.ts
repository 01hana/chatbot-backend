import { BadRequestException, Injectable } from '@nestjs/common';
import { IntentService } from '../intent/intent.service';
import { KnowledgeCategoryService } from '../knowledge-category/knowledge-category.service';

type ResolveIntentLabelInput = {
  category?: string | null;
  intentLabel?: string | null;
};

type SuggestTagsInput = {
  title?: string | null;
  category?: string | null;
  intentLabel?: string | null;
  content?: string | null;
  language?: string | null;
};

const MAX_TAG_LENGTH = 30;

/**
 * Centralized Knowledge Admin classification helpers.
 *
 * Keeps intent validation and tag suggestion logic out of Admin controllers.
 */
@Injectable()
export class KnowledgeClassificationService {
  constructor(
    private readonly intentService: IntentService,
    private readonly knowledgeCategoryService: KnowledgeCategoryService,
  ) {}

  async resolveIntentLabel(input: ResolveIntentLabelInput): Promise<string | null> {
    const explicitIntentLabel = this.cleanValue(input.intentLabel);
    if (explicitIntentLabel) {
      this.assertActiveIntentLabel(explicitIntentLabel);
      return explicitIntentLabel;
    }

    const category = this.cleanValue(input.category);
    if (!category) return null;

    return this.knowledgeCategoryService.resolveDefaultIntentLabel(category);
  }

  suggestTags(input: SuggestTagsInput): string[] {
    return this.uniqueTags([
      input.title,
      input.category,
      input.intentLabel,
      ...this.extractChineseQuotedTerms(input.content),
      ...this.suggestTagsFromGlossary(input),
    ]);
  }

  mergeTags(...tagGroups: Array<readonly string[] | null | undefined>): string[] {
    return this.uniqueTags(tagGroups.flatMap(tags => tags ?? []));
  }

  private assertActiveIntentLabel(intentLabel: string): void {
    const exists = this.intentService
      .getCachedTemplates()
      .some(template => template.title === intentLabel && template.isActive !== false);

    if (!exists) {
      throw new BadRequestException(`Unknown or inactive intentLabel: ${intentLabel}`);
    }
  }

  private extractChineseQuotedTerms(content?: string | null): string[] {
    if (!content) return [];

    const terms: string[] = [];
    const matcher = /「([^」]+)」/g;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(content)) !== null) {
      terms.push(match[1]);
    }
    return terms;
  }

  private suggestTagsFromGlossary(_input: SuggestTagsInput): string[] {
    // Future extension point: match GlossaryTerm.term / synonyms against content.
    return [];
  }

  private uniqueTags(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const tags: string[] = [];

    for (const value of values) {
      const tag = this.cleanValue(value);
      if (!tag || tag.length > MAX_TAG_LENGTH || seen.has(tag)) continue;

      seen.add(tag);
      tags.push(tag);
    }

    return tags;
  }

  private cleanValue(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }
}
