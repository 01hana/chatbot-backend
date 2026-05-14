/**
 * QueryNormalizer — lightweight string normalisation for incoming queries.
 *
 * Rules applied (language-independent unless noted):
 *   1. trim()                     — remove leading / trailing whitespace
 *   2. Collapse internal spaces   — multiple consecutive spaces → single space
 *   3. Full-width → half-width    — U+FF01–U+FF5E → U+0021–U+007E
 *                                   Full-width space U+3000 → U+0020
 *
 * What is deliberately NOT done here:
 *   - No Chinese word segmentation (done by ITokenizer)
 *   - No stop-word removal (done by ITokenizer / classifiers)
 *   - No lowercasing of Chinese characters
 *   - No Unicode NFC/NFD normalisation (preserve intent)
 */
export class QueryNormalizer {
  /**
   * Normalise a raw user query.
   *
   * @param rawQuery  The original string from the request body.
   * @param language  ISO language tag ('zh-TW' | 'en').  Reserved for
   *                  future locale-specific rules; currently unused.
   * @returns The normalised query string.
   */
  static normalize(rawQuery: string, _language: string): string {
    return QueryNormalizer.collapseSpaces(
      QueryNormalizer.fullWidthToHalfWidth(rawQuery.trim()),
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Convert full-width ASCII variants (U+FF01–U+FF5E) and the ideographic
   * space (U+3000) to their half-width equivalents.
   *
   * Chinese characters (U+4E00–U+9FFF and CJK Extension blocks) are
   * intentionally left untouched.
   */
  private static fullWidthToHalfWidth(text: string): string {
    return text
      .replace(/\u3000/g, ' ')   // ideographic space → ASCII space
      .replace(/[\uFF01-\uFF5E]/g, (char) =>
        String.fromCharCode(char.charCodeAt(0) - 0xfee0),
      );
  }

  /**
   * Collapse two or more consecutive whitespace characters (including tabs,
   * line feeds) into a single ASCII space.
   */
  private static collapseSpaces(text: string): string {
    return text.replace(/\s{2,}/g, ' ');
  }
}
