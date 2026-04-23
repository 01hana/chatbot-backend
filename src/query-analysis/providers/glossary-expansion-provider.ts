import { Injectable } from '@nestjs/common';
import type { GlossaryTerm } from '../../generated/prisma/client';
import type { IQueryExpansionProvider } from '../interfaces/query-expansion-provider.interface';
import { IntentService } from '../../intent/intent.service';

/**
 * GlossaryExpansionProvider — IQueryExpansionProvider backed by the IntentService
 * in-memory glossary cache.
 *
 * For each input term, the provider checks whether the term (or any of its
 * forms) appears in any GlossaryTerm entry.  When a match is found, all
 * synonyms from that entry are appended to the output.  The output list is
 * deduplicated and lowercased for consistent downstream processing.
 *
 * This avoids direct DB access — the IntentService already manages the
 * glossary cache lifecycle (load on startup, invalidate after admin edits).
 */
@Injectable()
export class GlossaryExpansionProvider implements IQueryExpansionProvider {
  constructor(private readonly intentService: IntentService) {}

  /**
   * Expand the given terms using the glossary.
   *
   * @param terms    - Extracted search terms (mixed case, as tokenised).
   * @param language - Language code (currently unused; glossary is language-agnostic).
   * @returns Deduplicated array of original terms plus any matched synonyms.
   */
  async expand(terms: string[], _language: string): Promise<string[]> {
    const glossary: Readonly<GlossaryTerm[]> = this.intentService.getCachedGlossary();

    const expanded = new Set<string>(terms.map(t => t.toLowerCase()));

    for (const term of terms) {
      const lowerTerm = term.toLowerCase();

      for (const entry of glossary) {
        const allForms = [entry.term, ...entry.synonyms].map(f => f.toLowerCase());

        if (allForms.some(f => f === lowerTerm || lowerTerm.includes(f) || f.includes(lowerTerm))) {
          for (const form of allForms) {
            expanded.add(form);
          }
        }
      }
    }

    return Array.from(expanded);
  }
}
