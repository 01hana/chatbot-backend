import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntentTemplate, GlossaryTerm } from '../generated/prisma/client';

/**
 * IntentRepository — thin data-access layer for intent-related tables.
 *
 * Responsibilities:
 *  - Query `intent_templates` for intent detection rules.
 *  - Query `glossary_terms` for domain vocabulary / synonym expansion.
 *  - No business logic; all matching lives in IntentService.
 */
@Injectable()
export class IntentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return all intent templates ordered by priority (descending) then id.
   */
  async findAllTemplates(): Promise<IntentTemplate[]> {
    return this.prisma.intentTemplate.findMany({
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * Return all glossary terms.
   */
  async findAllGlossary(): Promise<GlossaryTerm[]> {
    return this.prisma.glossaryTerm.findMany({
      orderBy: { id: 'asc' },
    });
  }
}
