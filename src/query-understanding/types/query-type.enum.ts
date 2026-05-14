/**
 * QueryType — high-level classification of the user's intent.
 *
 * Used by QueryTypeClassifier to route queries through the pipeline.
 * Classifier evaluation order (enforced in QueryTypeClassifier):
 *   1. Contact
 *   2. BusinessHours  (must precede hasBusiness to avoid misclassification)
 *   3. CatalogDownload  (hasBusiness + isCatalogQuery)
 *   4. QuoteRequest     (hasBusiness)
 *   5. ProductComparison (hasProduct + isComparisonQuery)
 *   6. ProductLookup    (hasProduct || hasMaterial)
 *   7. Unsupported      (onlyNoise)
 *   8. Unknown
 */
export enum QueryType {
  /** Query about a specific product or material */
  ProductLookup = 'product_lookup',
  /** Query comparing two or more products */
  ProductComparison = 'product_comparison',
  /** Request for a price quote */
  QuoteRequest = 'quote_request',
  /** Request for contact information */
  Contact = 'contact',
  /** Request to download a product catalog */
  CatalogDownload = 'catalog_download',
  /** Query about business hours or office location */
  BusinessHours = 'business_hours',
  /** General FAQ not fitting the above categories */
  GeneralFaq = 'general_faq',
  /** Query that the system explicitly cannot support */
  Unsupported = 'unsupported',
  /** Query that cannot be classified */
  Unknown = 'unknown',
}
