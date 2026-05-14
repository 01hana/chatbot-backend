import { QueryToken } from '../types/query-token.type.js';
import { QueryType } from '../types/query-type.enum.js';
import { TokenType } from '../types/token-type.enum.js';

// ── Pattern constants ─────────────────────────────────────────────────────────

/**
 * Matches queries about business hours, operating days, or office location.
 *
 * Must be tested BEFORE the generic `hasBusiness` check to prevent
 * "上班時間" from being classified as QuoteRequest.
 *
 * zh-TW patterns: 上班, 下班, 營業, 辦公, 工作時間, 工作日, 幾點, 幾號, 地址, 位置, 在哪, 地點
 * en patterns:   office hours, business hours, location, address
 */
const BUSINESS_HOURS_RE =
  /上班|下班|營業|辦公|工作時間|工作日|幾點|幾號|地址|位置|在哪|地點|office\s*hours?|business\s*hours?|location|address/i;

/**
 * Matches catalog / brochure / download intent.
 *
 * zh-TW: 型錄, 目錄
 * en: catalog, brochure, download
 */
const CATALOG_RE = /型錄|目錄|catalog|brochure|download|下載/i;

/**
 * Matches comparison / differentiation signal.
 *
 * zh-TW: 差異, 差在哪, 比較
 * en: vs, versus, difference, compare
 */
const COMPARISON_RE = /差異|差在|比較|vs\.?|versus|difference|compare|compared/i;

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * QueryTypeClassifier — maps `(tokens, normalizedQuery)` → `QueryType`.
 *
 * Evaluation order (must not be reordered; see `QueryType` enum comment):
 *   1. hasContact          → Contact
 *   2. isBusinessHoursQuery → BusinessHours     ← before hasBusiness
 *   3. hasBusiness && isCatalogQuery → CatalogDownload
 *   4. hasBusiness         → QuoteRequest
 *   5. hasProduct|hasMaterial && isComparisonQuery → ProductComparison
 *   6. hasProduct || hasMaterial → ProductLookup
 *   7. onlyNoise           → Unsupported
 *   8. Unknown             (catch-all)
 *
 * Design constraints:
 *  - No full-sentence exact-match hardcoding.
 *  - Decisions are based on TokenType signals and normalised regex patterns.
 */
export class QueryTypeClassifier {
  /**
   * Classify the intent of a query.
   *
   * @param tokens          Classified tokens produced by an ITokenizer.
   * @param normalizedQuery Normalised query string (full-width → half-width, trimmed).
   * @returns The QueryType that best matches the user's intent.
   */
  static classify(tokens: QueryToken[], normalizedQuery: string): QueryType {
    const hasContact = tokens.some((t) => t.tokenType === TokenType.Contact);
    const hasBusiness = tokens.some((t) => t.tokenType === TokenType.Business);
    const hasProduct = tokens.some((t) => t.tokenType === TokenType.Product);
    const hasMaterial = tokens.some((t) => t.tokenType === TokenType.Material);

    // A query is "only noise" when every token is Noise or Unknown AND at
    // least one token exists (empty token list → Unknown, not Unsupported).
    const onlyNoise =
      tokens.length > 0 &&
      tokens.every(
        (t) => t.tokenType === TokenType.Noise || t.tokenType === TokenType.Unknown,
      );

    // ── Step 1: explicit contact / communication signal ───────────────────
    if (hasContact) return QueryType.Contact;

    // ── Step 2: business hours / location ────────────────────────────────
    // Checked BEFORE generic hasBusiness to prevent "上班時間" → QuoteRequest.
    if (QueryTypeClassifier.isBusinessHoursQuery(normalizedQuery)) {
      return QueryType.BusinessHours;
    }

    // ── Step 3: catalog download (business token + catalog pattern) ───────
    if (hasBusiness && QueryTypeClassifier.isCatalogQuery(normalizedQuery)) {
      return QueryType.CatalogDownload;
    }

    // ── Step 4: quote / other business transactional intent ───────────────
    if (hasBusiness) return QueryType.QuoteRequest;

    // ── Step 5: product comparison (comparison signal + product/material) ──
    if (
      (hasProduct || hasMaterial) &&
      QueryTypeClassifier.isComparisonQuery(normalizedQuery)
    ) {
      return QueryType.ProductComparison;
    }

    // ── Step 6: product or material lookup ────────────────────────────────
    if (hasProduct || hasMaterial) return QueryType.ProductLookup;

    // ── Step 7: all tokens are noise → explicitly unsupported ─────────────
    if (onlyNoise) return QueryType.Unsupported;

    // ── Step 8: catch-all ─────────────────────────────────────────────────
    return QueryType.Unknown;
  }

  // ── Pattern helpers (exposed for unit testing) ───────────────────────────

  /**
   * Returns `true` when the normalised query matches business-hours /
   * location keywords.
   *
   * @internal Exposed for unit tests; prefer `classify()` in production code.
   */
  static isBusinessHoursQuery(normalizedQuery: string): boolean {
    return BUSINESS_HOURS_RE.test(normalizedQuery);
  }

  /**
   * Returns `true` when the normalised query matches catalog / download intent.
   *
   * @internal Exposed for unit tests; prefer `classify()` in production code.
   */
  static isCatalogQuery(normalizedQuery: string): boolean {
    return CATALOG_RE.test(normalizedQuery);
  }

  /**
   * Returns `true` when the normalised query matches comparison / differentiation
   * signal keywords.
   *
   * @internal Exposed for unit tests; prefer `classify()` in production code.
   */
  static isComparisonQuery(normalizedQuery: string): boolean {
    return COMPARISON_RE.test(normalizedQuery);
  }
}
