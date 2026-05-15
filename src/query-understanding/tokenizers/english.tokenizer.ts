import { ITokenizer } from './tokenizer.interface.js';
import { QueryToken } from '../types/query-token.type.js';
import { TokenType } from '../types/token-type.enum.js';

// ── Stop words ────────────────────────────────────────────────────────────────

/**
 * Common English stop words that carry no semantic value in a product-domain
 * query.  Checked after lowercasing.
 *
 * Design note: domain-significant words (hours, address, contact, etc.) are
 * intentionally ABSENT so they can be classified as Business / Contact tokens.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its',
  'he', 'she', 'they', 'them', 'their',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could',
  'how', 'what', 'when', 'where', 'which', 'who', 'why',
  'in', 'on', 'at', 'by', 'for', 'of', 'to', 'up', 'out', 'into',
  'with', 'from', 'that', 'this', 'these', 'those',
  'and', 'or', 'but', 'if', 'as', 'so', 'yet', 'not', 'no',
  'please', 'help', 'need', 'want', 'like', 'know', 'tell', 'me',
  'get', 'give', 'go', 'come', 'see', 'use', 'make', 'find',
  'there', 'here',
  'any', 'all', 'some', 'more', 'much', 'many', 'most',
  'about', 'than', 'then', 'also', 'just', 'only',
  'available', 'offer', 'offers', 'provide', 'provides',
  'company', 'product', 'products', 'item', 'items', 'type', 'types',
  'kind', 'kinds', 'sort', 'sorts', 'list',
]);

// ── Multi-word phrases ─────────────────────────────────────────────────────────

/**
 * Ordered list of multi-word phrases to extract before single-token
 * classification.  Entries must be lowercased.
 *
 * Each entry: [phrase, TokenType, weight]
 * Phrases are tried longest-first (sorted by token count descending at build
 * time via insertion order — longest entries first in the array).
 */
const PHRASE_TABLE: [string, TokenType, number][] = [
  // Material (multi-word first)
  ['stainless steel', TokenType.Material, 0.8],
  ['carbon steel',   TokenType.Material, 0.8],
  // Business (multi-word first)
  ['business hours', TokenType.Business, 0.7],
  ['office hours',   TokenType.Business, 0.7],
];

// ── Single-token classification ───────────────────────────────────────────────

/**
 * Spec patterns: grade codes, metric sizes, standards.
 * Anchored (^ … $) to prevent partial matches inside longer tokens.
 */
const SPEC_RE =
  /^(304|316|316L|410|420|430|M\d+(\.\d+)?|ISO[-\s]?\d+|DIN[-\s]?\d+|JIS[-\s]?\w+|\d+mm|\d+cm|\d+m|\d+"|\d+inch(es)?)$/i;

/**
 * Product terms: fastener product names.
 */
const PRODUCT_RE =
  /^(screw|screws|bolt|bolts|nut|nuts|washer|washers|fastener|fasteners|wire|wires|rivet|rivets|stud|studs|anchor|anchors)$/i;

/**
 * Material terms: individual material words (phrase variants handled above).
 */
const MATERIAL_RE =
  /^(galvanized|galvanised|aluminum|aluminium|copper|brass|titanium|zinc|nickel|chrome|steel)$/i;

/**
 * Business terms: commercial / operational signals.
 * Explicitly includes hours, address, location so they are NOT noise.
 */
const BUSINESS_RE =
  /^(quote|quotation|quotes|price|prices|pricing|priced|catalog|catalogs|catalogue|catalogues|brochure|brochures|download|downloads|hours|address|location)$/i;

/**
 * Contact terms: communication channels.
 */
const CONTACT_RE =
  /^(contact|email|phone|call|line|whatsapp|fax|chat|sales)$/i;

// ── Weight table ──────────────────────────────────────────────────────────────

const WEIGHT_BY_TYPE: Record<TokenType, number> = {
  [TokenType.Product]:   0.9,
  [TokenType.Spec]:      0.85,
  [TokenType.Material]:  0.8,
  [TokenType.Dimension]: 0.75,
  [TokenType.Business]:  0.7,
  [TokenType.Contact]:   0.7,
  [TokenType.Action]:    0.5,
  [TokenType.Unknown]:   0.3,
  [TokenType.Noise]:     0.1,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Classify a single lowercased token (no phrases; already stop-word filtered).
 *
 * Priority order (first match wins):
 *   1. Spec    (grade/size/standard codes)
 *   2. Product (fastener names)
 *   3. Material (individual material words)
 *   4. Business (commercial / operational)
 *   5. Contact
 *   6. Unknown  (default — meaningful but unrecognised)
 *
 * Noise is NOT produced here for single tokens; stop words are filtered
 * upstream.  This keeps keyPhrases free of Noise entries.
 */
function classifySingleToken(token: string): TokenType {
  if (SPEC_RE.test(token))     return TokenType.Spec;
  if (PRODUCT_RE.test(token))  return TokenType.Product;
  if (MATERIAL_RE.test(token)) return TokenType.Material;
  if (BUSINESS_RE.test(token)) return TokenType.Business;
  if (CONTACT_RE.test(token))  return TokenType.Contact;
  return TokenType.Unknown;
}

function makeToken(text: string, tokenType: TokenType): QueryToken {
  return {
    text,
    normalizedText: text.toLowerCase(),
    tokenType,
    weight: WEIGHT_BY_TYPE[tokenType],
    source: 'english',
  };
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

/**
 * EnglishTokenizer — implements ITokenizer for English queries.
 *
 * Pipeline:
 *   1. Lowercase the input.
 *   2. Extract recognised multi-word phrases (longest-match first), removing
 *      their constituent words from further processing.
 *   3. Split remaining text on whitespace and punctuation.
 *   4. Filter stop words.
 *   5. Classify each remaining token.
 *   6. Return all phrase and single-token results as QueryToken[].
 *
 * Design constraints:
 *   - No exact full-sentence matching.
 *   - No dependency on Jieba or nodejieba.
 *   - Never throws; returns [] on unrecoverable error.
 *   - All tokens have source='english'.
 */
export class EnglishTokenizer implements ITokenizer {
  async tokenize(text: string, _language: string): Promise<QueryToken[]> {
    try {
      return this.doTokenize(text);
    } catch {
      return [];
    }
  }

  // ── Private pipeline ──────────────────────────────────────────────────────

  private doTokenize(text: string): QueryToken[] {
    if (!text || !text.trim()) return [];

    const lower = text.toLowerCase();
    const tokens: QueryToken[] = [];

    // Track character positions consumed by phrase extraction so single-token
    // processing can skip them.
    const consumedRanges: [number, number][] = [];

    // ── Step 1: extract multi-word phrases ──────────────────────────────
    for (const [phrase, tokenType] of PHRASE_TABLE) {
      let searchFrom = 0;
      while (searchFrom < lower.length) {
        const idx = lower.indexOf(phrase, searchFrom);
        if (idx === -1) break;

        // Ensure phrase is not inside another word (word-boundary check)
        const before = idx === 0 ? true : /[\s,.\-!?;:()/]/.test(lower[idx - 1]);
        const afterIdx = idx + phrase.length;
        const after = afterIdx >= lower.length ? true : /[\s,.\-!?;:()/]/.test(lower[afterIdx]);

        if (before && after) {
          consumedRanges.push([idx, afterIdx]);
          tokens.push(makeToken(phrase, tokenType));
        }
        searchFrom = idx + 1;
      }
    }

    // ── Step 2: mask consumed ranges and split the rest ─────────────────
    // Replace consumed positions with spaces so they don't produce tokens.
    let masked = lower.split('');
    for (const [start, end] of consumedRanges) {
      for (let i = start; i < end; i++) {
        masked[i] = ' ';
      }
    }
    const maskedText = masked.join('');

    // ── Step 3: split on non-alphanumeric boundaries ─────────────────────
    // Keep alphanumeric runs and internal hyphens/dots (M3, ISO-4762, M3.5).
    const rawTokens = maskedText.split(/[^a-z0-9.\-]+/).filter((t) => t.length > 0);

    // ── Step 4: filter stop words and classify ───────────────────────────
    for (const raw of rawTokens) {
      if (STOP_WORDS.has(raw)) continue;
      if (raw.length === 0) continue;

      const tokenType = classifySingleToken(raw);
      tokens.push(makeToken(raw, tokenType));
    }

    return tokens;
  }
}
