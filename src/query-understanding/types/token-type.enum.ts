/**
 * TokenType — classifies a single token extracted from a user query.
 *
 * Used by ITokenizer implementations and QueryTypeClassifier.
 */
export enum TokenType {
  /** Identified product name, model, or product family */
  Product = 'product',
  /** Technical specification: grade (304/316), size (M3/M4), dimension, tolerance */
  Spec = 'spec',
  /** Material or surface treatment: 不鏽鋼, 碳鋼, 鍍鋅 */
  Material = 'material',
  /** Physical dimension: 長度, 直徑, 厚度 */
  Dimension = 'dimension',
  /** Action verb or transactional intent: 購買, 訂購, 詢價 */
  Action = 'action',
  /** Business-operation keyword: 上班時間, 營業時間, 公司地址, 型錄 */
  Business = 'business',
  /** Contact or communication intent: 聯絡, email, 電話 */
  Contact = 'contact',
  /** Filler / question-shell word with no semantic content: 請問, 你們, 一些 */
  Noise = 'noise',
  /** Could not be classified into any above category */
  Unknown = 'unknown',
}
