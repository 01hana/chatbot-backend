import { RuleBasedTokenizer as Tokenizer002 } from '../../query-analysis/tokenizers/rule-based-tokenizer.js';
import { ITokenizer } from './tokenizer.interface.js';
import { QueryToken } from '../types/query-token.type.js';
import { TokenType } from '../types/token-type.enum.js';

// ── Classification patterns ──────────────────────────────────────────────────
//
// These patterns classify individual *tokens* (not full sentences) into
// semantic categories.  Order matters within each test suite but does not
// imply query-level intent — that is done by QueryTypeClassifier.

/** Product terms: hardware fastener names, model identifiers */
const PRODUCT_RE =
  /^(螺絲|螺栓|螺帽|華司|墊圈|六角|沉頭|自攻|screw|bolt|nut|washer|fastener|rivet|stud|anchor)$/i;

/** Material / surface-treatment terms */
const MATERIAL_RE =
  /^(不鏽鋼|碳鋼|鍍鋅|鋁|銅|黑色氧化|電鍍|galvanized|stainless|carbon\s*steel|aluminum|copper|brass|titanium|zinc)$/i;

/** Business-operation terms: hours, location, catalog, pricing signals */
const BUSINESS_RE =
  /^(報價|詢價|型錄|目錄|業務|上班|下班|營業|辦公|工作時間|公司地址|地址|位置|catalog|brochure|download|quote|pricing)$/i;

/** Contact / communication terms */
const CONTACT_RE =
  /^(聯絡|聯繫|電話|手機|信箱|mail|email|contact|phone|line|whatsapp|fax|傳真)$/i;

/** Technical spec identifiers: grades, sizes, standards */
const SPEC_RE =
  /^(304|316|316L|410|420|M\d+(\.\d+)?|ISO[-\s]?\d+|DIN[-\s]?\d+|JIS[-\s]?\w+|inch|\d+mm|\d+cm|\d+")/i;

/** Noise: question-shell words, filler particles */
const NOISE_RE =
  /^(請問|你們|我想知道|可以|麻煩|告訴我|想問|幫我|查一下|一下|嗎|呢|啊|喔|好嗎|有哪些|是什麼|怎麼|如何|什麼|哪些|哪裡|這個|那個)$/i;

// ── Default weight table ─────────────────────────────────────────────────────

const WEIGHT_BY_TYPE: Record<TokenType, number> = {
  [TokenType.Product]: 0.9,
  [TokenType.Spec]: 0.85,
  [TokenType.Material]: 0.8,
  [TokenType.Dimension]: 0.75,
  [TokenType.Business]: 0.7,
  [TokenType.Contact]: 0.7,
  [TokenType.Action]: 0.5,
  [TokenType.Noise]: 0.1,
  [TokenType.Unknown]: 0.3,
};

// ── Classifier helper ────────────────────────────────────────────────────────

/**
 * Classify a single normalised token text into a TokenType.
 *
 * Rules applied in priority order (first match wins):
 *   1. Spec patterns (must precede product/material to avoid e.g. "M3" → product)
 *   2. Product
 *   3. Material
 *   4. Business
 *   5. Contact
 *   6. Noise
 *   7. Unknown (default)
 */
function classifyToken(text: string): TokenType {
  if (SPEC_RE.test(text)) return TokenType.Spec;
  if (PRODUCT_RE.test(text)) return TokenType.Product;
  if (MATERIAL_RE.test(text)) return TokenType.Material;
  if (BUSINESS_RE.test(text)) return TokenType.Business;
  if (CONTACT_RE.test(text)) return TokenType.Contact;
  if (NOISE_RE.test(text)) return TokenType.Noise;
  return TokenType.Unknown;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

/**
 * RuleBasedTokenizer — 003 ITokenizer adapter around the 002
 * `RuleBasedTokenizer` (bi-gram / sliding-window character tokeniser).
 *
 * Responsibility boundary:
 *   - Text segmentation is fully delegated to the 002 tokenizer (no copy).
 *   - This adapter converts `string[]` tokens → `QueryToken[]` with semantic
 *     classification and default weights.
 *   - All tokens produced here have `source = 'rule-based'`.
 *
 * NOT a retrieval component — no stop-word removal, bigram expansion, or
 * domain-signal logic is performed here.
 */
export class RuleBasedTokenizerAdapter implements ITokenizer {
  /** Underlying 002 tokenizer (stateless; safe to share) */
  private readonly tokenizer002 = new Tokenizer002();

  /**
   * Tokenise `text` and return classified `QueryToken[]`.
   *
   * Strategy:
   *   1. Delegate segmentation to the 002 tokenizer (returns `string[]`).
   *   2. For each pair of adjacent tokens, also emit a bigram candidate.
   *      This allows multi-character patterns (e.g. `螺絲`) to be recognised
   *      even when the underlying segmenter emits single characters.
   *   3. Classify each unique candidate via `classifyToken()`.
   *
   * Never rejects; returns `[]` on unexpected errors.
   *
   * @param text      Normalised query string (full-width already converted).
   * @param language  ISO language tag: 'zh-TW' | 'en'.
   */
  async tokenize(text: string, language: string): Promise<QueryToken[]> {
    try {
      const rawTokens: string[] = this.tokenizer002.tokenize(text, language);

      // Build candidate list: single tokens + adjacent bigrams.
      // Bigrams allow compound tokens like "螺絲" to be recognised even when the
      // underlying tokeniser (002) emits single CJK characters.
      const candidates: string[] = [];
      for (let i = 0; i < rawTokens.length; i++) {
        candidates.push(rawTokens[i]);
        if (i < rawTokens.length - 1) {
          candidates.push(rawTokens[i] + rawTokens[i + 1]);
        }
      }

      // Deduplicate and convert to QueryToken, preserving insertion order.
      const seen = new Set<string>();
      const tokens: QueryToken[] = [];
      for (const raw of candidates) {
        const trimmed = raw.trim();
        if (trimmed.length === 0 || seen.has(trimmed)) continue;
        seen.add(trimmed);
        const qt = this.toQueryToken(trimmed);
        if (qt !== null) tokens.push(qt);
      }
      return tokens;
    } catch {
      return [];
    }
  }

  /** Convert a raw string token from 002 into a QueryToken. */
  private toQueryToken(raw: string): QueryToken | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;

    const tokenType = classifyToken(trimmed);
    return {
      text: trimmed,
      normalizedText: trimmed,
      tokenType,
      weight: WEIGHT_BY_TYPE[tokenType],
      source: 'rule-based',
    };
  }
}
