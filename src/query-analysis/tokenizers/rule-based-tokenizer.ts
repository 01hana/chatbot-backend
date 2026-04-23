import { ITokenizer } from '../interfaces/tokenizer.interface';

/**
 * RuleBasedTokenizer — language-aware text tokeniser.
 *
 * Strategy:
 *  - English: split on whitespace and ASCII punctuation; preserve alphanumerics
 *    and mixed tokens like "M3", "ISO-4762".
 *  - Chinese (zh-TW): split on whitespace / ASCII punctuation first; within
 *    each segment that contains CJK characters, emit every character that is
 *    either a CJK codepoint or an ASCII alphanumeric run (e.g. "M3螺絲" →
 *    ["M3", "螺", "絲"]). This heuristic avoids a heavy segmentation library
 *    while still giving per-character units for bi-gram phrase detection.
 *
 * Empty tokens and pure-whitespace tokens are always filtered out.
 */
export class RuleBasedTokenizer implements ITokenizer {
  /** CJK Unified Ideographs and CJK Extension A range. */
  private static readonly CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/u;

  /**
   * Tokenise a normalised text string.
   *
   * @param text     Normalised input (post-question-shell removal).
   * @param language Language code: 'zh-TW' | 'en'.
   * @returns        Non-empty token array.
   */
  tokenize(text: string, language: string): string[] {
    if (!text || !text.trim()) return [];

    if (language === 'en') {
      return this.tokenizeEnglish(text);
    }
    return this.tokenizeChinese(text);
  }

  // ── private ──────────────────────────────────────────────────────────────

  private tokenizeEnglish(text: string): string[] {
    // Split on whitespace and common punctuation, keep alphanumeric runs with
    // optional internal hyphens/dots (e.g. "ISO-4762", "M3.5").
    return text
      .split(/[\s,，。.?？!！;；:：()\[\]{}"""'']+/)
      .map(t => t.trim())
      .filter(t => t.length > 0);
  }

  private tokenizeChinese(text: string): string[] {
    const tokens: string[] = [];

    // First split on whitespace / ASCII punctuation to get coarse segments.
    const segments = text.split(/[\s,，。.?？!！;；:：()\[\]{}"""'']+/);

    for (const segment of segments) {
      if (!segment) continue;

      if (!RuleBasedTokenizer.CJK_RE.test(segment)) {
        // Pure ASCII / numeric segment (e.g. "M3", "ISO-4762") — keep whole.
        if (segment.trim().length > 0) tokens.push(segment.trim());
        continue;
      }

      // Mixed or pure CJK segment: emit ASCII runs whole, emit CJK chars one-by-one.
      let buffer = '';
      for (const ch of segment) {
        if (RuleBasedTokenizer.CJK_RE.test(ch)) {
          if (buffer.length > 0) {
            tokens.push(buffer);
            buffer = '';
          }
          tokens.push(ch);
        } else if (/[A-Za-z0-9\-.]/.test(ch)) {
          buffer += ch;
        } else {
          // Punctuation / other: flush buffer.
          if (buffer.length > 0) {
            tokens.push(buffer);
            buffer = '';
          }
        }
      }
      if (buffer.length > 0) tokens.push(buffer);
    }

    return tokens.filter(t => t.length > 0);
  }
}
