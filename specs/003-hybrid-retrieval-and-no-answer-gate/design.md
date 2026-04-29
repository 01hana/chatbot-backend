# 技術設計文件：混合式檢索與無答案閘門

**功能分支**：`003-hybrid-retrieval-no-answer-gate`  
**建立日期**：2026-04-29  
**狀態**：草稿  
**前置功能**：002-query-analysis-foundation  
**對應規格**：[spec.md](./spec.md)

---

## 目錄

1. [Overview](#1-overview)
2. [Target Architecture](#2-target-architecture)
3. [Feature Flags & Rollout](#3-feature-flags--rollout)
4. [Query Understanding V2 Design](#4-query-understanding-v2-design)
5. [Tokenizer Design](#5-tokenizer-design)
6. [Knowledge Model Design](#6-knowledge-model-design)
7. [Hybrid Retrieval Design](#7-hybrid-retrieval-design)
8. [RetrievalDecision / No-answer Gate Design](#8-retrievaldecision--no-answer-gate-design)
9. [ChatPipeline Integration](#9-chatpipeline-integration)
10. [GeneratedAnswer / Traceability](#10-generatedanswer--traceability)
11. [AuditLog / Observability](#11-auditlog--observability)
12. [Testing Strategy](#12-testing-strategy)
13. [Migration / Rollback](#13-migration--rollback)
14. [Risks / Open Questions](#14-risks--open-questions)

---

## 1. Overview

### 003 解決的問題

001 建立了可運作的 SSE chat pipeline，002 加入了 `QueryAnalysisModule`、`AnswerTemplateResolver`、`DiagnosisService` 及 `KnowledgeEntry` 結構化欄位。但實際前台測試揭露三個結構性缺陷：

1. **Query Understanding 職責錯置**：弱詞過濾、bigram 產生、domain signal 偵測等語言理解邏輯散落於 `PostgresRetrievalService`，造成關鍵字 retriever 承擔不應有的職責，且難以測試與替換。

2. **無答案閘門缺失**：任何分數超過 `rag_minimum_score` 的檢索結果都會觸發 LLM 呼叫，即使命中的是間接相關或低品質條目。這造成不必要的 API 費用及 LLM 幻覺風險。

3. **zh-TW 分詞品質不足**：規則式 bigram 無法有效區分「螺絲」（產品詞）與「上班時間」（問句殼層詞），導致誤命中與誤報。

### 003 的交付範圍

**交付項目：**
- `QueryUnderstandingService` V2（JiebaTokenizer / EnglishTokenizer / RuleBasedTokenizer）
- `QueryTypeClassifier` + `SupportabilityClassifier`
- `HybridRetrievalService`（`KeywordRetriever` 為主要可用 retriever；`VectorRetriever` / `GraphRetriever` 為 interface + stub 或 simple Postgres join）
- `RetrievalDecision` / No-answer Gate（在 LLM 前強制執行 `canAnswer` 檢查）
- `GeneratedAnswer` 含 `sourceReferences`（始終保留）及 `answerMode`（5 種）
- `KnowledgeDocument` / `KnowledgeChunk` / `KnowledgeEntity` / `KnowledgeRelation` 加法性 Prisma schema
- AuditLog V2 擴充欄位

**不在 003 範圍：**
- 完整 Microsoft-style GraphRAG（community detection、community summary、完整多跳 graph traversal）
- Neo4j 或外部圖資料庫
- pgvector embedding 生成與 vector search（`VectorRetriever` stub 即可）
- Knowledge Graph Admin UI
- Jieba 字典管理 UI

### 設計文件中的 Code Snippet 定位

本文中的 TypeScript code snippets（包含 `TokenizerProvider`、`JiebaTokenizer`、`QueryUnderstandingService`、`RetrievalDecisionService`、`HybridRetrievalService` 等）為 **architecture-level pseudocode / contract sketch**，用於表達 service responsibility、interface shape 與 data flow。實際實作時應依現有 NestJS module/provider patterns、專案命名慣例與實際套件 API 調整，不要求逐字照抄。

---

## 2. Target Architecture

### 整體請求流程

```
POST /api/v1/chat/sessions/:sessionToken/messages
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  ChatPipelineService（現有 11 steps，加入新 steps）          │
│                                                             │
│  Step 1  validateInput                                      │
│  Step 2  detectLanguage                                     │
│  Step 2.5 [NEW] QueryUnderstandingService V2                │
│           │  feature.query_understanding_v2_enabled=true    │
│           │  → TokenizerProvider → JiebaTokenizer /         │
│           │    EnglishTokenizer / RuleBasedTokenizer         │
│           │  → QueryTypeClassifier                          │
│           │  → SupportabilityClassifier                     │
│           └→ QueryUnderstandingResult                       │
│                                                             │
│  Step 3  runPromptGuard (SafetyService, unchanged)          │
│  Step 4  checkConfidentiality (SafetyService, unchanged)    │
│  Step 5  detectIntent (IntentService, unchanged)            │
│                                                             │
│  Step 6  retrieveKnowledge                                  │
│           │  feature.hybrid_retrieval_enabled=true          │
│           │  → HybridRetrievalService                       │
│           │    → KeywordRetriever (pg_trgm / ILIKE)         │
│           │    → VectorRetriever (stub → [])                │
│           │    → GraphRetriever (stub or Postgres join)     │
│           │    → RetrievalFusionService (dedup + rerank)    │
│           │  feature.hybrid_retrieval_enabled=false         │
│           └→ PostgresRetrievalService (002 路徑，unchanged) │
│                                                             │
│  Step 6.5 [NEW] RetrievalDecision / No-answer Gate          │
│           │  feature.no_answer_gate_enabled=true            │
│           │  canAnswer=false → write fallback SSE, done     │
│           └  canAnswer=true  → continue                     │
│                                                             │
│  Step 7  evaluateConfidence (unchanged)                     │
│  Step 8  buildPrompt (unchanged)                            │
│                                                             │
│  Step 9  resolveTemplate (AnswerTemplateResolver, unchanged)│
│           → answerMode=template / rag+template: SSE, done   │
│           → answerMode=hybrid_rag / llm: continue           │
│                                                             │
│  Step 10 callLlmStream (ILlmProvider, unchanged)            │
│  Step 11 writeAndReturn                                      │
│           → GeneratedAnswer { message, sourceReferences,    │
│             answerMode, confidence, trace? }                 │
│           → AuditLog V2                                     │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
SSE stream to client (token / status / done events)
```

### 模組依賴關係

```
ChatModule
  ├── QueryUnderstandingModule (NEW)
  │     ├── TokenizerProvider
  │     │     ├── JiebaTokenizer
  │     │     ├── EnglishTokenizer
  │     │     └── RuleBasedTokenizer (fallback)
  │     ├── QueryTypeClassifier
  │     ├── SupportabilityClassifier
  │     │     └── KnowledgeAvailabilityChecker (NEW)
  │     └── RetrievalPlanBuilder
  ├── HybridRetrievalModule (NEW)
  │     ├── KeywordRetriever
  │     ├── VectorRetriever (interface + stub)
  │     ├── GraphRetriever (interface + stub/simple join)
  │     ├── RetrievalFusionService
  │     ├── RerankerService
  │     └── RetrievalDecisionService
  ├── QueryAnalysisModule (002, fallback path, unchanged)
  ├── TemplateModule (002, unchanged)
  ├── IntentModule (002, unchanged)
  ├── SafetyModule (001, unchanged)
  └── LlmModule (001, unchanged)
```

> **架構說明（No-answer Gate 路徑）**：No-answer Gate（Step 6.5）支援兩種輸入路徑。Hybrid path（`feature.hybrid_retrieval_enabled=true`）由 `HybridRetrievalService` 產生 `ChunkResult[]` 後呼叫 `RetrievalDecisionService.decideFromChunks()`；Legacy path（`feature.hybrid_retrieval_enabled=false`）由 `PostgresRetrievalService` 產生 `RetrievalResult[]` 後呼叫 `decideFromRetrievalResults()`。只要 `feature.no_answer_gate_enabled=true`，兩條路徑均在 Step 6 末尾填入 `ctx.retrievalDecision`，由 Step 6.5 統一檢查。**`feature.hybrid_retrieval_enabled=false` 不會讓 No-answer Gate 失效。**

---

## 3. Feature Flags & Rollout

所有 003 功能均以 `SystemConfig`（key/value Postgres table）控制，預設 `false`。

| Flag | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| `feature.query_understanding_v2_enabled` | boolean | `false` | 啟用 QU V2 管線（含 Jieba、分類器） |
| `feature.zh_tokenizer` | string | `rule-based` | `rule-based` 或 `jieba`，僅在 QU V2 啟用時生效 |
| `feature.hybrid_retrieval_enabled` | boolean | `false` | 啟用 `HybridRetrievalService` |
| `feature.no_answer_gate_enabled` | boolean | `false` | 在 LLM 前強制 `canAnswer` 閘門 |
| `feature.traceable_answer_enabled` | boolean | `false` | 啟用 `trace` 及 chunk-level metadata |

### Rollout 順序建議

1. **Phase A**：部署所有 flags=false。003 程式碼上線，行為與 002 完全相同。
2. **Phase B**：`feature.query_understanding_v2_enabled=true`，`feature.zh_tokenizer=rule-based`。QU V2 啟動但使用現有 RuleBasedTokenizer，觀察 AuditLog 中的 `queryType` / `supportability` 分布。
3. **Phase C**：`feature.no_answer_gate_enabled=true`。啟用 No-answer Gate，監控 `canAnswer=false` 比率與 fallback 品質。
4. **Phase D**：`feature.zh_tokenizer=jieba`。切換 zh-TW 分詞至 Jieba，以 regression suite 驗證。
5. **Phase E**：`feature.hybrid_retrieval_enabled=true`。啟用 HybridRetrievalService（V1 以 KeywordRetriever 為主）。
6. **Phase F**：`feature.traceable_answer_enabled=true`。啟用詳細 trace metadata。
7. **GA**：所有 flags 通過 regression + 監控後，準備將 `feature.query_understanding_v2_enabled` 設為 default。執行舊路徑 cleanup。

---

## 4. Query Understanding V2 Design

### 目錄結構

```
src/query-understanding/
  query-understanding.module.ts
  query-understanding.service.ts
  tokenizers/
    tokenizer.interface.ts
    tokenizer-provider.service.ts
    jieba.tokenizer.ts
    english.tokenizer.ts
    rule-based.tokenizer.ts
  classifiers/
    query-type.classifier.ts
    supportability.classifier.ts
  builders/
    retrieval-plan.builder.ts
  types/
    token-type.enum.ts
    query-type.enum.ts
    query-token.type.ts
    query-understanding-result.type.ts
    retrieval-plan.type.ts
```

### 核心型別

```typescript
// token-type.enum.ts
export enum TokenType {
  Product   = 'product',    // 產品名稱：螺絲、螺栓、螺帽、華司、線材
  Spec      = 'spec',       // 規格識別碼：304、316、M3、M4、ISO 4762
  Material  = 'material',   // 材質：不鏽鋼、碳鋼、鍍鋅
  Dimension = 'dimension',  // 尺寸：10mm、直徑、長度
  Action    = 'action',     // 動詞意圖：查詢、了解、需要、找
  Business  = 'business',   // 商務詞彙：報價、型錄、下載、採購
  Contact   = 'contact',    // 聯絡詞彙：電話、Email、聯絡我們
  Noise     = 'noise',      // 問句殼層 / 停用詞：你們、我想知道、請問、可以、麻煩
                            // 注意：上班時間 / 營業時間 / 公司地址屬於 Business，不是 Noise
  Unknown   = 'unknown',    // 無法分類
}

// query-type.enum.ts
export enum QueryType {
  ProductLookup     = 'product_lookup',
  ProductComparison = 'product_comparison',
  QuoteRequest      = 'quote_request',
  Contact           = 'contact',
  CatalogDownload   = 'catalog_download',
  BusinessHours     = 'business_hours',
  GeneralFaq        = 'general_faq',
  Unsupported       = 'unsupported',
  Unknown           = 'unknown',
}

// query-token.type.ts
export interface QueryToken {
  text: string;
  normalizedText: string;
  tokenType: TokenType;
  weight: number;          // 0.0–1.0
  source: 'jieba' | 'rule-based' | 'english' | 'dictionary' | 'glossary' | 'classifier';
  // dictionary : token 命中 domain dictionary 後強化分類
  // glossary   : token 與 GlossaryTerm 匹配後覆寫
  // classifier : 由 pattern classifier 覆寫 tokenType
}

// query-understanding-result.type.ts
export interface QueryUnderstandingResult {
  rawQuery: string;
  normalizedQuery: string;
  language: string;                    // 'zh-TW' | 'en'
  tokenizer: 'jieba' | 'rule-based' | 'english';
  tokens: QueryToken[];
  keyPhrases: string[];               // 高權重 token 文字清單（weight ≥ 0.7）
  intentCandidates: string[];         // 對應 IntentService 的意圖候選
  queryType: QueryType;
  supportability: 'supported' | 'unsupported' | 'unknown';
  unsupportedReason?: string;         // 僅 unsupported 時填入
  retrievalPlan: RetrievalPlan;
  debugMeta?: Record<string, unknown>; // 各步驟耗時，僅 dev/debug 環境
}
```

### `ITokenizer` 介面

```typescript
// tokenizers/tokenizer.interface.ts
export interface ITokenizer {
  tokenize(text: string, language: string): Promise<QueryToken[]>;
}
```

### `TokenizerProvider`

```typescript
// tokenizers/tokenizer-provider.service.ts
@Injectable()
export class TokenizerProvider {
  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly jiebaTokenizer: JiebaTokenizer,
    private readonly englishTokenizer: EnglishTokenizer,
    private readonly ruleBasedTokenizer: RuleBasedTokenizer,
  ) {}

  async getTokenizer(language: string): Promise<ITokenizer> {
    if (language === 'en') return this.englishTokenizer;

    const zhTokenizer = await this.systemConfigService.get('feature.zh_tokenizer');
    if (zhTokenizer === 'jieba') {
      if (!this.jiebaTokenizer.isReady()) {
        this.logger.warn('[TokenizerProvider] Jieba not ready, falling back to RuleBasedTokenizer');
        return this.ruleBasedTokenizer;
      }
      return this.jiebaTokenizer;
    }
    return this.ruleBasedTokenizer;
  }
}
```

**核心設計原則**：`TokenizerProvider` 在 Jieba 不可用時必須靜默 fallback，不得拋出例外。

### `QueryUnderstandingService`

```typescript
@Injectable()
export class QueryUnderstandingService {
  async understand(
    rawQuery: string,
    language: string,
  ): Promise<QueryUnderstandingResult> {
    const t0 = Date.now();

    // 1. Normalize
    const normalizedQuery = QueryNormalizer.normalize(rawQuery, language);

    // 2. Select tokenizer & tokenize
    const tokenizer = await this.tokenizerProvider.getTokenizer(language);
    const tokens = await tokenizer.tokenize(normalizedQuery, language);
    const tokenizerName = this.tokenizerProvider.getLastUsedName();

    // 3. Extract key phrases (weight ≥ 0.7, non-noise)
    const keyPhrases = tokens
      .filter(t => t.weight >= 0.7 && t.tokenType !== TokenType.Noise)
      .map(t => t.normalizedText);

    // 4. Classify query type
    const queryType = this.queryTypeClassifier.classify(tokens, normalizedQuery);

    // 5. Classify supportability (checks KB state)
    const { supportability, unsupportedReason } =
      await this.supportabilityClassifier.classify(queryType, tokens, language);

    // 6. Build retrieval plan（language 必須明確傳入，不留空字串）
    const retrievalPlan = this.retrievalPlanBuilder.build(tokens, queryType, supportability, language);

    return {
      rawQuery,
      normalizedQuery,
      language,
      tokenizer: tokenizerName,
      tokens,
      keyPhrases,
      intentCandidates: [],    // populated by IntentService downstream
      queryType,
      supportability,
      unsupportedReason,
      retrievalPlan,
      debugMeta: { durationMs: Date.now() - t0 },
    };
  }
}
```

### `QueryTypeClassifier`

分類邏輯基於 token type 分布和關鍵詞模式，不依賴 retrieval 層：

```typescript
@Injectable()
export class QueryTypeClassifier {
  classify(tokens: QueryToken[], normalizedQuery: string): QueryType {
    const hasProduct = tokens.some(t =>
      t.tokenType === TokenType.Product || t.tokenType === TokenType.Spec
    );
    const hasMaterial = tokens.some(t => t.tokenType === TokenType.Material);
    const hasBusiness = tokens.some(t => t.tokenType === TokenType.Business);
    const hasContact  = tokens.some(t => t.tokenType === TokenType.Contact);
    const onlyNoise   = tokens.every(t =>
      t.tokenType === TokenType.Noise || t.tokenType === TokenType.Unknown
    );

    // 明確 query pattern 應優先於 onlyNoise 判斷，避免誤殺有意義查詢
    // 注意：business_hours / company_info pattern 必須先於一般 hasBusiness 判斷，
    // 否則「上班時間 / 營業時間 / 公司地址」等詞會因 Business token 而被誤判為 QuoteRequest
    if (hasContact) return QueryType.Contact;
    if (this.isBusinessHoursQuery(normalizedQuery)) return QueryType.BusinessHours;
    if (hasBusiness && this.isCatalogQuery(normalizedQuery)) return QueryType.CatalogDownload;
    if (hasBusiness) return QueryType.QuoteRequest;
    if (hasProduct && this.isComparisonQuery(normalizedQuery)) return QueryType.ProductComparison;
    if (hasProduct || hasMaterial) return QueryType.ProductLookup;
    // 所有 token 均為 noise/unknown 才視為 unsupported
    if (onlyNoise) return QueryType.Unsupported;

    return QueryType.Unknown;
  }
}
```

### `SupportabilityClassifier`

動態查詢知識庫狀態，不以靜態 queryType 永久封鎖：

```typescript
@Injectable()
export class SupportabilityClassifier {
  async classify(
    queryType: QueryType,
    tokens: QueryToken[],
    language: string,
  ): Promise<{ supportability: string; unsupportedReason?: string }> {
    const allNoise = tokens.every(t =>
      t.tokenType === TokenType.Noise || t.tokenType === TokenType.Unknown
    );

    if (allNoise) {
      return { supportability: 'unsupported', unsupportedReason: 'all_tokens_noise' };
    }

    if (queryType === QueryType.Unsupported) {
      return { supportability: 'unsupported', unsupportedReason: 'classifier_unsupported' };
    }

    // 動態檢查：KB 中是否有對應類型的資料
    // 例如 BusinessHours → 查詢是否有 category='business_hours' 的 KnowledgeEntry
    const hasKbContent = await this.knowledgeAvailabilityChecker.hasContentFor(queryType, language);
    if (!hasKbContent) {
      return {
        supportability: 'unsupported',
        unsupportedReason: `no_kb_content_for_${queryType}`,
      };
    }

    return { supportability: 'supported' };
  }
}
```

### `KnowledgeAvailabilityChecker` Design

#### 職責

判斷目前知識庫是否有某 `QueryType` 對應的**可公開回答**資料。供 `SupportabilityClassifier` 注入使用，是 `unsupported` 判斷的動態依據。

#### 所屬 Module

`QueryUnderstandingModule`（或 `KnowledgeModule`，由 `SupportabilityClassifier` 透過 DI 注入）。

#### 查詢來源

- 既有 `KnowledgeEntry`（V1 主要資料來源）
- 新增 `KnowledgeDocument` / `KnowledgeChunk`（V2 擴充，與 `KnowledgeEntry` 並存）

#### 篩選條件

所有查詢必須套用以下條件，避免草稿或已下架內容影響支援判斷：

```
status = 'approved'
visibility = 'public'
deletedAt IS NULL（若 model 有軟刪除欄位）
language = 使用者語言（允許 fallback 至其他語言）
```

#### QueryType → 資料類型 Mapping

| QueryType | 查詢目標（KnowledgeEntry category / KnowledgeDocument docType） |
|-----------|---------------------------------------------------------------|
| `product_lookup` | `product_spec` / `faq` / product 相關 category |
| `product_comparison` | `product_spec` / material / spec 相關 category |
| `quote_request` | `quote` / `sales` / contact / handoff 類資料 |
| `contact` | `company_info` / contact 相關 category |
| `catalog_download` | `catalog` |
| `business_hours` | `business_hours` / `company_info` 相關 category |
| `general_faq` | `faq` / `general` |
| `unknown` | 所有 category（保守：若有任何內容則 supported） |

#### 快取策略

```typescript
// 建議：per-queryType TTL 快取，60 秒更新
// 失效條件：KnowledgeEntry / KnowledgeDocument CRUD 事件後 invalidate
// V1 可先不快取，若 SupportabilityClassifier 延遲影響 P95 > 50ms 再加入
```

#### Pseudocode

```typescript
@Injectable()
export class KnowledgeAvailabilityChecker {
  // 注入 PrismaService 或 KnowledgeRepository
  async hasContentFor(queryType: QueryType, language: string): Promise<boolean> {
    const categories = this.getCategoriesForQueryType(queryType);
    if (categories.length === 0) return true;  // unknown → conservative: allow

    // 先查 KnowledgeEntry（V1 路徑）
    const entryCount = await this.prisma.knowledgeEntry.count({
      where: {
        category: { in: categories },
        status: 'approved',
        visibility: 'public',
        deletedAt: null,
        // language fallback：優先 exact match，允許語言寬鬆匹配
      },
    });
    if (entryCount > 0) return true;

    // 再查 KnowledgeDocument（V2 路徑，003 新增表）
    const docCount = await this.prisma.knowledgeDocument.count({
      where: {
        docType: { in: this.getDocTypesForQueryType(queryType) },
        status: 'approved',
        visibility: 'public',
        deletedAt: null,
        // language fallback：優先 exact match，允許語言寬鬆匹配
      },
    });
    return docCount > 0;
  }

  private getCategoriesForQueryType(queryType: QueryType): string[] {
    const mapping: Record<string, string[]> = {
      business_hours: ['business_hours', 'company_info'],
      contact: ['company_info', 'contact'],
      catalog_download: ['catalog'],
      quote_request: ['quote', 'sales', 'contact'],
      product_lookup: ['product_spec', 'faq'],
      product_comparison: ['product_spec'],
      general_faq: ['faq', 'general'],
      unknown: [],
    };
    return mapping[queryType] ?? [];
  }
}
```

### `RetrievalPlanBuilder`

```typescript
export interface RetrievalPlan {
  searchTerms: string[];          // 過濾後的強 token（非 noise/unknown）
  strategies: RetrievalStrategy[]; // ['keyword', 'vector', 'graph']
  maxResults: number;
  language: string;
}

@Injectable()
export class RetrievalPlanBuilder {
  build(
    tokens: QueryToken[],
    queryType: QueryType,
    supportability: string,
    language: string,
  ): RetrievalPlan {
    // 只有非 noise/unknown 的 token 才進入 searchTerms
    const searchTerms = tokens
      .filter(t =>
        t.tokenType !== TokenType.Noise &&
        t.tokenType !== TokenType.Unknown
      )
      .sort((a, b) => b.weight - a.weight)
      .map(t => t.normalizedText);

    const strategies: RetrievalStrategy[] = ['keyword'];
    // vector/graph 可在未來 Phase 加入，V1 只有 keyword

    return {
      searchTerms,
      strategies,
      maxResults: 5,
      language,  // 由 QueryUnderstandingService 傳入，不允許空字串
    };
  }
}
```

---

## 5. Tokenizer Design

### `JiebaTokenizer`

**初始化**：使用 `nodejieba`（或同等 npm 套件）。在 `NestJS` module `onModuleInit` 時初始化。初始化失敗時輸出 WARN 日誌，標記 `_ready = false`，後續由 `TokenizerProvider` fallback 至 `RuleBasedTokenizer`。

```typescript
@Injectable()
export class JiebaTokenizer implements ITokenizer, OnModuleInit {
  private _ready = false;
  private readonly logger = new Logger(JiebaTokenizer.name);

  async onModuleInit(): Promise<void> {
    try {
      // 動態 require，避免在非 jieba 環境啟動失敗
      const jieba = await import('nodejieba');
      jieba.load({
        userDict: await this.buildDomainDictPath(),
      });
      this._ready = true;
    } catch (err) {
      this.logger.warn(`[JiebaTokenizer] Init failed: ${String(err)}. Will fallback.`);
    }
  }

  isReady(): boolean { return this._ready; }

  async tokenize(text: string, _language: string): Promise<QueryToken[]> {
    if (!this._ready) throw new Error('JiebaTokenizer not ready');

    const jieba = await import('nodejieba');
    const words = jieba.cut(text, true);      // 精確模式
    return words.map(word => this.classifyWord(word));
  }

  private classifyWord(word: string): QueryToken {
    // tokenType 分類規則：
    // - 在 domain dictionary 命中 → Product 或 Material（token source='dictionary'）
    // - GlossaryTerm 匹配 → 覆寫分類（token source='glossary'）
    // - 全數字 + 字母（304、316、M3、M4、ISO4762）→ Spec
    // - 尺寸關鍵字（mm、cm、直徑、長度）→ Dimension
    // - 停用詞表（你們、請問、可以）→ Noise
    // - 營業時間詞（上班時間、營業時間、公司地址）→ Business（非 Noise）
    // - 聯絡詞（電話、Email、聯絡）→ Contact
    // - 商務詞（報價、型錄、採購）→ Business
    // - 其他 → Unknown
    return { text: word, normalizedText: word.toLowerCase(), tokenType: ..., weight: ..., source: 'jieba' };
  }

  private async buildDomainDictPath(): Promise<string> {
    // 從 GlossaryTerm + KnowledgeEntry.tags 匯出臨時字典檔
    // V1 可先使用靜態字典檔
    return path.join(process.cwd(), 'config', 'jieba-domain.txt');
  }
}
```

**Native dependency 風險**：`nodejieba` 需要 C++ 編譯環境。Dockerfile 需確保 `node-gyp` 依賴（`python3`、`make`、`g++`）存在。CI pipeline 需在 build stage 驗證 `nodejieba` 能正常安裝與初始化。

**Domain 字典格式**（`config/jieba-domain.txt`）：
```
螺絲 10 n
螺栓 10 n
螺帽 10 n
華司 10 n
不鏽鋼 10 n
...
```

### `EnglishTokenizer`

```typescript
@Injectable()
export class EnglishTokenizer implements ITokenizer {
  private static readonly STOP_WORDS = new Set([
    'what', 'how', 'can', 'do', 'does', 'is', 'are', 'the', 'a', 'an',
    'i', 'we', 'you', 'your', 'our', 'my', 'please', 'help', 'me',
  ]);

  private static readonly PRODUCT_TERMS = new Set([
    'screw', 'bolt', 'nut', 'washer', 'wire', 'fastener', 'stainless', 'steel',
  ]);

  private static readonly BUSINESS_TERMS = new Set([
    'quote', 'quotation', 'price', 'catalog', 'catalogue', 'brochure', 'download',
    'hours', 'address', 'location',  // business_hours / company_address 類查詢應歸 Business，非 Noise
  ]);

  private static readonly COMPANY_TERMS = new Set([
    'company', 'office', 'directions',
  ]);

  private static readonly CONTACT_TERMS = new Set([
    'contact', 'email', 'phone', 'call', 'reach', 'sales',
  ]);

  async tokenize(text: string, _language: string): Promise<QueryToken[]> {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0 && !EnglishTokenizer.STOP_WORDS.has(w))
      .map(word => ({ text: word, normalizedText: word, tokenType: this.classify(word), weight: ..., source: 'english' as const }));
  }

  private classify(word: string): TokenType {
    if (EnglishTokenizer.PRODUCT_TERMS.has(word)) return TokenType.Product;
    if (EnglishTokenizer.BUSINESS_TERMS.has(word)) return TokenType.Business;
    if (EnglishTokenizer.CONTACT_TERMS.has(word)) return TokenType.Contact;
    if (/^\d{3}$/.test(word) || /^m\d+$/i.test(word)) return TokenType.Spec;
    if (/\d+(mm|cm|inch)/i.test(word)) return TokenType.Dimension;
    return TokenType.Unknown;
  }
}
```

### `RuleBasedTokenizer`（Fallback only）

沿用 002 `RuleBasedQueryAnalyzer` 的 bi-gram / sliding window 邏輯，包裝為 `ITokenizer`。所有 token 均輸出 `source: 'rule-based'`。tokenType 分類較粗糙，但確保管線不斷路。

---

## 6. Knowledge Model Design

### 新增 Prisma Model（加法性 migration）

```prisma
// 加入 schema.prisma，不修改現有 KnowledgeEntry

model KnowledgeDocument {
  id          String               @id @default(cuid())
  sourceKey   String               @unique
  title       String
  docType     KnowledgeDocType
  language    String               @default("zh-TW")
  status      String               @default("draft")
  visibility  String               @default("private")
  metadata    Json?
  deletedAt   DateTime?
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt
  chunks      KnowledgeChunk[]
}

enum KnowledgeDocType {
  faq
  product_spec
  catalog
  company_info
  general
}

model KnowledgeChunk {
  id               String            @id @default(cuid())
  documentId       String
  document         KnowledgeDocument @relation(fields: [documentId], references: [id])
  content          String
  chunkIndex       Int
  tokenCount       Int               @default(0)
  language         String            @default("zh-TW")
  metadata         Json?
  embeddingId      String?           // nullable in V1; used by VectorRetriever in 004+
  // visibility 繼承自父 KnowledgeDocument；KnowledgeAvailabilityChecker 透過 document.visibility / document.deletedAt 過濾
  sourceReference  String?           // e.g. "KnowledgeEntry:entry_id_123"
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  @@index([documentId])
  @@index([language])
}

model KnowledgeEntity {
  id           String              @id @default(cuid())
  name         String
  entityType   KnowledgeEntityType
  canonicalKey String              @unique
  fromRelations KnowledgeRelation[] @relation("FromEntity")
  toRelations   KnowledgeRelation[] @relation("ToEntity")
  createdAt    DateTime            @default(now())
}

enum KnowledgeEntityType {
  product
  spec
  category
  company
}

model KnowledgeRelation {
  id           String               @id @default(cuid())
  fromEntityId String
  fromEntity   KnowledgeEntity      @relation("FromEntity", fields: [fromEntityId], references: [id])
  toEntityId   String
  toEntity     KnowledgeEntity      @relation("ToEntity", fields: [toEntityId], references: [id])
  relationType KnowledgeRelationType
  createdAt    DateTime             @default(now())

  @@index([fromEntityId])
  @@index([toEntityId])
}

enum KnowledgeRelationType {
  is_variant_of
  belongs_to_category
  compatible_with
  see_also
}
```

### KnowledgeEntry Backfill（選用）

003 不強制 backfill。若需要，可提供 seed script：

```typescript
// prisma/seeds/backfill-knowledge-documents.seed.ts
// 遍歷所有 KnowledgeEntry，依 sourceKey 建立對應 KnowledgeDocument
// 將 KnowledgeEntry.content 切分為 KnowledgeChunk（V1 每筆 1 chunk）
// KnowledgeChunk.sourceReference = `KnowledgeEntry:${entry.id}`
```

---

## 7. Hybrid Retrieval Design

### 目錄結構

```
src/hybrid-retrieval/
  hybrid-retrieval.module.ts
  hybrid-retrieval.service.ts
  retrievers/
    keyword.retriever.ts
    vector.retriever.interface.ts
    vector.retriever.stub.ts
    graph.retriever.interface.ts
    graph.retriever.stub.ts           ← V1 default
    graph.retriever.postgres.ts       ← V1 可選 simple Postgres join 實作
  fusion/
    retrieval-fusion.service.ts
    reranker.service.ts
  gate/
    retrieval-decision.service.ts
  types/
    retrieval-decision.type.ts
    chunk-result.type.ts
```

### 介面定義

```typescript
// retrievers/vector.retriever.interface.ts
export interface IVectorRetriever {
  retrieve(searchTerms: string[], language: string, limit: number): Promise<ChunkResult[]>;
}
export const VECTOR_RETRIEVER = Symbol('VECTOR_RETRIEVER');

// retrievers/graph.retriever.interface.ts
export interface IGraphRetriever {
  expand(entityKeys: string[], limit: number): Promise<ChunkResult[]>;
}
export const GRAPH_RETRIEVER = Symbol('GRAPH_RETRIEVER');

export interface ChunkResult {
  chunkId?: string;            // V2 KnowledgeChunk.id（string cuid）；hybrid 路徑
  knowledgeEntryId?: number;   // V1 KnowledgeEntry.id（number）；legacy 路徑；兩者至少一個必填
  sourceKey: string;
  content: string;
  score: number;
  language: string;
  isCrossLanguageFallback?: boolean;
}
```

### `KeywordRetriever`

包裝現有 `PostgresRetrievalService`，接受來自 `RetrievalPlan.searchTerms` 的乾淨搜尋詞清單。**不得包含任何語言分析邏輯。**

```typescript
@Injectable()
export class KeywordRetriever {
  constructor(
    @Inject(RETRIEVAL_SERVICE) private readonly postgresService: IRetrievalService,
  ) {}

  async retrieve(plan: RetrievalPlan): Promise<ChunkResult[]> {
    const results: ChunkResult[] = [];

    for (const term of plan.searchTerms) {
      const retrieved = await this.postgresService.retrieve({
        query: term,
        language: plan.language,
        limit: plan.maxResults,
      });
      results.push(...retrieved.map(r => this.toChunkResult(r)));
    }

    // Dedup by knowledgeEntryId（legacy path），keep highest score
    return this.dedup(results).slice(0, plan.maxResults);
  }

  private toChunkResult(r: RetrievalResult): ChunkResult {
    return {
      knowledgeEntryId: r.entry.id,  // V1：KnowledgeEntry.id 為 number
      sourceKey: r.entry.sourceKey ?? '',
      content: r.entry.content,
      score: r.score,
      language: r.entry.language,
      isCrossLanguageFallback: r.isCrossLanguageFallback,
    };
  }
}
```

### `VectorRetriever` Stub（V1）

```typescript
@Injectable()
export class VectorRetrieverStub implements IVectorRetriever {
  retrieve(_searchTerms: string[], _language: string, _limit: number): Promise<ChunkResult[]> {
    return Promise.resolve([]);
  }
}
```

### `GraphRetriever`（V1：stub 或 simple Postgres join）

**Stub 實作（預設）**：
```typescript
@Injectable()
export class GraphRetrieverStub implements IGraphRetriever {
  expand(_entityKeys: string[], _limit: number): Promise<ChunkResult[]> {
    return Promise.resolve([]);
  }
}
```

**Simple Postgres join 實作（可選）**：
```typescript
@Injectable()
export class GraphRetrieverPostgres implements IGraphRetriever {
  async expand(entityKeys: string[], limit: number): Promise<ChunkResult[]> {
    // 查詢 KnowledgeRelation，找出 relatedEntityKeys
    // 再以 relatedEntityKeys 查詢 KnowledgeChunk
    // 一跳展開，不做多跳
    const relations = await this.prisma.knowledgeRelation.findMany({
      where: { fromEntity: { canonicalKey: { in: entityKeys } } },
      include: { toEntity: true },
      take: limit * 2,
    });
    // ... 轉換為 ChunkResult
    return [];
  }
}
```

### `RetrievalFusionService`

```typescript
@Injectable()
export class RetrievalFusionService {
  fuse(
    keyword: ChunkResult[],
    vector: ChunkResult[],
    graph: ChunkResult[],
  ): ChunkResult[] {
    const all = [...keyword, ...vector, ...graph];
    // Dedup by canonical key（chunkId 優先，否則 `entry:${knowledgeEntryId}`）
    const map = new Map<string, ChunkResult>();
    for (const r of all) {
      const key = r.chunkId ?? `entry:${r.knowledgeEntryId}`;
      const existing = map.get(key);
      if (!existing || r.score > existing.score) map.set(key, r);
    }
    return [...map.values()];
  }
}
```

### `RerankerService`

V1 以 BM25-style term frequency boost 為主。與現有 `rerankWithTerms()` 邏輯對齊：

```typescript
@Injectable()
export class RerankerService {
  rerank(results: ChunkResult[], searchTerms: string[]): ChunkResult[] {
    return results
      .map(r => ({
        ...r,
        score: r.score + this.termBonus(r.content, searchTerms),
      }))
      .sort((a, b) => b.score - a.score);
  }

  private termBonus(content: string, terms: string[]): number {
    let bonus = 0;
    for (const term of terms) {
      if (content.includes(term)) bonus += 0.03;
    }
    return Math.min(bonus, 0.15);
  }
}
```

### `HybridRetrievalService`

```typescript
@Injectable()
export class HybridRetrievalService {
  async retrieve(
    plan: RetrievalPlan,
    limit: number,
  ): Promise<ChunkResult[]> {
    // V1: Vector 與 Graph 回傳 []，以 Keyword 為主
    const [keyword, vector, graph] = await Promise.all([
      this.keywordRetriever.retrieve(plan),
      this.vectorRetriever.retrieve(plan.searchTerms, plan.language, limit),
      this.graphRetriever.expand(
        plan.searchTerms.filter(t => this.isEntity(t)),
        limit,
      ),
    ]);

    const fused = this.fusionService.fuse(keyword, vector, graph);
    return this.rerankerService.rerank(fused, plan.searchTerms).slice(0, limit);
  }
}
```

**V1 行為說明**：由於 `VectorRetriever` 與 `GraphRetriever` 均回傳 `[]`，`HybridRetrievalService` V1 的實際行為與 `KeywordRetriever` 相同。`canAnswer` 判斷僅依賴 keyword 結果，不受未完成的 vector/graph 影響。

---

## 8. RetrievalDecision / No-answer Gate Design

### 設計原則：Gate 支援 Hybrid 與 Legacy 兩條路徑

**關鍵限制**：Rollout 順序中 `feature.no_answer_gate_enabled` 可能在 `feature.hybrid_retrieval_enabled` 之前開啟（Phase C vs Phase E）。因此 No-answer Gate 必須能在兩種輸入下運作：

| 輸入來源 | 資料型別 | 使用方法 |
|---------|---------|---------|
| HybridRetrievalService（hybrid path） | `ChunkResult[]` | `decideFromChunks()` |
| PostgresRetrievalService（legacy path） | `RetrievalResult[]` | `decideFromRetrievalResults()` |

無論哪條路徑，只要 `feature.no_answer_gate_enabled=true`，Step 6 結束時就必須填入 `ctx.retrievalDecision`，並由 Step 6.5 統一檢查。

### `RetrievalDecision` 型別

```typescript
export interface RetrievalDecision {
  canAnswer: boolean;
  reason: string;
  confidence: number;   // 0–1，最高分結果的 score
  topK: ChunkResult[];
}
```

### `RetrievalDecisionService`

```typescript
@Injectable()
export class RetrievalDecisionService {
  /**
   * Hybrid path：接受 HybridRetrievalService 產生的 ChunkResult[]
   */
  async decideFromChunks(
    chunks: ChunkResult[],
    understandingResult: QueryUnderstandingResult | undefined,
    minScore: number,
  ): Promise<RetrievalDecision> {
    return this.evaluate(chunks, understandingResult, minScore);
  }

  /**
   * Legacy path：接受 PostgresRetrievalService 產生的 RetrievalResult[]
   * 先轉換為 ChunkResult[]，再走相同評估邏輯
   */
  async decideFromRetrievalResults(
    results: RetrievalResult[],
    understandingResult: QueryUnderstandingResult | undefined,
    minScore: number,
  ): Promise<RetrievalDecision> {
    const chunks = results.map(r => this.toChunkResult(r));
    return this.evaluate(chunks, understandingResult, minScore);
  }

  private toChunkResult(r: RetrievalResult): ChunkResult {
    return {
      knowledgeEntryId: r.entry.id,
      sourceKey: r.entry.sourceKey ?? '',
      content: r.entry.content,
      score: r.score,
      language: r.entry.language,
      isCrossLanguageFallback: r.isCrossLanguageFallback,
    };
  }

  private evaluate(
    chunks: ChunkResult[],
    understandingResult: QueryUnderstandingResult | undefined,
    minScore: number,
  ): RetrievalDecision {
    // (a) No results
    if (chunks.length === 0) {
      return { canAnswer: false, reason: 'no_results', confidence: 0, topK: [] };
    }

    // (b) Low score
    const topScore = Math.max(...chunks.map(c => c.score));
    if (topScore < minScore) {
      return { canAnswer: false, reason: 'low_score', confidence: topScore, topK: chunks };
    }

    if (understandingResult) {
      // (c) Unsupported by SupportabilityClassifier
      if (understandingResult.supportability === 'unsupported') {
        return {
          canAnswer: false,
          reason: understandingResult.unsupportedReason ?? 'unsupported',
          confidence: topScore,
          topK: chunks,
        };
      }

      // (d) All tokens are noise/unknown
      const allNoise = understandingResult.tokens.every(t =>
        t.tokenType === TokenType.Noise || t.tokenType === TokenType.Unknown
      );
      if (allNoise) {
        return { canAnswer: false, reason: 'all_tokens_noise', confidence: topScore, topK: chunks };
      }
    }

    return { canAnswer: true, reason: 'ok', confidence: topScore, topK: chunks };
  }
}
```

### No-answer Gate 在 Pipeline 中的位置（Step 6.5）

```typescript
// ChatPipelineService Step 6.5
private async applyNoAnswerGate(
  ctx: PipelineContext,
): Promise<boolean> {  // returns true if should continue
  const enabled = await this.systemConfigService.getBool('feature.no_answer_gate_enabled');
  if (!enabled) return true;

  // ctx.retrievalDecision 由 Step 6 無論 hybrid/legacy 路徑均填入
  if (!ctx.retrievalDecision) return true;

  if (!ctx.retrievalDecision.canAnswer) {
    await this.writeFallbackSse(ctx, ctx.retrievalDecision.reason);
    await this.writeAuditLog(ctx, {
      action: ChatAction.Fallback,
      llmCalled: false,
      canAnswer: false,
      fallbackReason: ctx.retrievalDecision.reason,
    });
    return false;
  }
  return true;
}
```

### `answerMode=llm` / `hybrid_rag` 的 Gate 限制

`feature.no_answer_gate_enabled=true` 時，**llm / hybrid_rag 模式均必須在 `canAnswer=true` 後才允許呼叫 LLM**。若 `canAnswer=false`，無論原本打算用哪種 answerMode，最終都必須輸出 `answerMode=fallback`，`llmCalled=false`。

> **不允許**：`canAnswer=false` 但仍把 query 送給 OpenAI 讓 LLM 自行回答（無 context 的幻覺風險）。

| `canAnswer` | `answerMode` | `llmCalled` |
|------------|-------------|------------|
| `false` | `fallback` | false |
| `true` | `llm` / `hybrid_rag` | true |
| `true` | `rag+template` / `template` | false |

---

## 9. ChatPipeline Integration

### 修改原則

1. 所有修改以 feature flags 為開關，預設行為與 002 完全相同。
2. **不修改**：Step 1–5、Step 7–8、Step 10 的核心邏輯。
3. **擴充** Step 2.5：加入 QU V2 路徑。
4. **新增** Step 6.5：No-answer Gate。
5. **擴充** Step 11：AuditLog V2 欄位。

### `PipelineContext` 擴充

```typescript
interface PipelineContext {
  // ... 現有欄位 ...

  /** QU V2 輸出（feature.query_understanding_v2_enabled=true 時填入）*/
  queryUnderstandingResult?: QueryUnderstandingResult;

  /** 無答案閘門决策（feature.no_answer_gate_enabled=true 時，無論 hybrid 或 legacy 路徑均填入）*/
  retrievalDecision?: RetrievalDecision;

  /** 最終答案封包 */
  generatedAnswer?: GeneratedAnswer;
}
```

### Step 2.5 修改

```typescript
private async analyzeQuery(ctx: PipelineContext): Promise<void> {
  const quV2Enabled = await this.systemConfigService.getBool(
    'feature.query_understanding_v2_enabled'
  );

  if (quV2Enabled) {
    ctx.queryUnderstandingResult = await this.queryUnderstandingService.understand(
      ctx.userMessage,
      ctx.language,
    );
    // 同時保留 002 analyzedQuery 格式以供下游相容
    ctx.analyzedQuery = this.adaptToAnalyzedQuery(ctx.queryUnderstandingResult);
    return;
  }

  // 002 fallback path（不變）
  const qaEnabled = await this.systemConfigService.getBool('feature.query_analysis_enabled');
  if (qaEnabled) {
    ctx.analyzedQuery = await this.queryAnalysisService.analyze(ctx.userMessage, ctx.language);
  }
}
```

### Step 6 修改

```typescript
private async retrieveKnowledge(ctx: PipelineContext): Promise<void> {
  const hybridEnabled = await this.systemConfigService.getBool(
    'feature.hybrid_retrieval_enabled'
  );

  if (hybridEnabled && ctx.queryUnderstandingResult) {
    const plan = ctx.queryUnderstandingResult.retrievalPlan;
    const minScore = await this.systemConfigService.getNumber('rag_minimum_score', 0.25);
    const chunks = await this.hybridRetrievalService.retrieve(plan, 5);

    ctx.retrievalDecision = await this.retrievalDecisionService.decideFromChunks(
      chunks,
      ctx.queryUnderstandingResult,
      minScore,
    );
    // Map chunks → ragResults for downstream compatibility
    ctx.ragResults = this.chunksToRetrievalResults(ctx.retrievalDecision.topK);
    return;
  }

  // 002 legacy path：PostgresRetrievalService
  const query = this.buildRetrievalQuery(ctx);
  ctx.ragResults = await this.retrievalService.retrieve(query);

  // Step 6.5 準備：no_answer_gate_enabled=true 時，legacy 路徑也需要產生 ctx.retrievalDecision
  const gateEnabled = await this.systemConfigService.getBool('feature.no_answer_gate_enabled');
  if (gateEnabled) {
    const minScore = await this.systemConfigService.getNumber('rag_minimum_score', 0.25);
    ctx.retrievalDecision = await this.retrievalDecisionService.decideFromRetrievalResults(
      ctx.ragResults,
      ctx.queryUnderstandingResult,  // 若 QU V2 未啟用則為 undefined
      minScore,
    );
  }
}
```

### answerMode 到 ChatAction 的映射

| answerMode | ChatAction | llmCalled |
|------------|-----------|-----------|
| `llm` | `answer` | true |
| `hybrid_rag` | `answer` | true |
| `rag+template` | `template` | false |
| `template` | `template` | false |
| `fallback` | `fallback` | false |

**`answerMode=llm` / `hybrid_rag` 的 Gate 限制**：

`feature.no_answer_gate_enabled=true` 時，`llm` 與 `hybrid_rag` 模式**必須在 `ctx.retrievalDecision.canAnswer=true` 後**才允許呼叫 LLM。若 `canAnswer=false`，無論原本計畫哪種 answerMode，最終輸出均為 `answerMode=fallback`，`llmCalled=false`。

> **禁止**：`canAnswer=false` 但仍呼叫 LLM，讓 OpenAI 在缺乏可信 context 的情況下自行生成回答（LLM 幻覺風險）。`template` / `rag+template` 模式因不呼叫 LLM，不受 No-answer Gate 阻擋，但也不能產生脫離知識庫內容的回答。

### SSE done payload 向下相容

現有 `SseDonePayload` 不修改。`sourceReferences` 及 `trace` 以 optional 欄位加法性新增，不影響未升級的客戶端。

---

## 10. GeneratedAnswer / Traceability

### 型別定義

```typescript
export interface SourceReference {
  knowledgeEntryId?: number;  // V1 legacy 路徑（KnowledgeEntry.id）
  chunkId?: string;           // V2 chunk 路徑（KnowledgeChunk.id）；兩者至少一個必填
  sourceKey: string;
  title?: string;             // 可選：entry / document 標題，供前台引用顯示
  language?: string;
  category?: string;
  score?: number;
  chunkIndex: number;         // 在本次回應的位置索引
}

export type AnswerMode = 'llm' | 'rag+template' | 'template' | 'hybrid_rag' | 'fallback';

export interface GeneratedAnswer {
  message: string;
  sourceReferences: SourceReference[];   // 始終存在（可為空陣列）
  answerMode: AnswerMode;
  confidence: number;
  trace?: AnswerTrace;                   // 僅 feature.traceable_answer_enabled=true 時填充
}

export interface AnswerTrace {
  queryUnderstandingMs: number;
  retrievalMs: number;
  fusionMs: number;
  llmMs?: number;
  totalMs: number;
  chunkDetails?: ChunkTraceDetail[];
}

export interface ChunkTraceDetail {
  chunkId: string;
  score: number;
  retriever: string;
  tokenType: string;
}
```

### `sourceReferences` 的建立

```typescript
private buildSourceReferences(chunks: ChunkResult[]): SourceReference[] {
  return chunks.map((c, idx) => ({
    knowledgeEntryId: c.knowledgeEntryId,
    chunkId: c.chunkId,
    sourceKey: c.sourceKey,
    score: c.score,
    chunkIndex: idx,
  }));
}
```

`sourceReferences` 在 `template`、`rag+template`、`hybrid_rag`、`llm` 四種 answerMode 下均填充；`fallback` 時為空陣列 `[]`。`feature.traceable_answer_enabled` 只控制 `trace` 欄位及 `chunkDetails` 的填充，不影響 `sourceReferences` 的存在。

**`answerMode=llm` 與 No-answer Gate 的關係**：`answerMode=llm` 或 `hybrid_rag` 不代表可繞過 No-answer Gate。`feature.no_answer_gate_enabled=true` 時，必須先等 `canAnswer=true` 才能呈現這兩種模式。若 `canAnswer=false`，就算原先打算用 `llm`，最終產出模式也必須改為 `fallback`。

---

## 11. AuditLog / Observability

### AuditLog V2 新增欄位

現有 `AuditService` 欄位不刪除，加法性新增：

```typescript
export interface AuditLogV2Payload extends AuditLogPayload {
  // --- Query Understanding V2（feature.query_understanding_v2_enabled=true 時填入）---
  queryUnderstanding?: {
    tokenizer: string;
    tokens: Array<{ text: string; tokenType: string; weight: number; source: string }>;
    queryType: string;
    supportability: string;
    unsupportedReason?: string;
    keyPhrases: string[];
  };

  // --- Retrieval（feature.hybrid_retrieval_enabled=true 時填入）---
  retrievalPlan?: {
    searchTerms: string[];
    strategies: string[];
  };
  retrievalCandidates?: Array<{
    chunkId?: string;            // V2 chunk 路徑
    knowledgeEntryId?: number;   // V1 legacy 路徑
    score: number;
    retriever: string;           // 'keyword' | 'vector' | 'graph' | 'legacy'
  }>;
  retrievalDecision?: {
    canAnswer: boolean;
    reason: string;
    confidence: number;
  };

  // --- Answer ---
  answerMode?: AnswerMode;          // 實際使用的回答模式
  sourceReferences?: SourceReference[];
  llmCalled: boolean;
  canAnswer?: boolean;             // No-answer Gate 決策（no_answer_gate_enabled=true 時填入）
  fallbackReason?: string;         // canAnswer=false 時的具體原因

  // --- Trace（feature.traceable_answer_enabled=true 時填入）---
  trace?: AnswerTrace;
}
```

### 可觀測性重點指標

| 指標 | 目的 |
|------|------|
| `queryType` 分布 | 監控查詢類型偏移 |
| `supportability=unsupported` 比率 | 監控 No-answer Gate 觸發率 |
| `canAnswer=false` by reason | 識別常見 fallback 原因 |
| `tokenizer=jieba` vs `rule-based` 分布 | 監控 Jieba fallback 頻率 |
| `answerMode` 分布 | 監控 LLM 呼叫比率 |
| P95 `queryUnderstandingMs` | Tokenizer 效能 |

---

## 12. Testing Strategy

### Tokenizer 單元測試

```
src/query-understanding/tokenizers/
  jieba.tokenizer.spec.ts
    - zh-TW 產品詞（螺絲、螺栓）正確分類為 product
    - 規格識別碼（304、316、M3、M4）保留為 spec
    - 問句殼層詞彙（你們、請問、可以）分類為 noise
    - 「上班時間 / 營業時間 / 公司地址」分類為 business（非 noise）
    - 初始化失敗時 isReady()=false，不拋例外
    - token.source 正確標記（'jieba' / 'dictionary' / 'glossary'）
  english.tokenizer.spec.ts
    - 停用詞移除（what, how, please 等）
    - product/spec/contact/business 分類正確
    - 'hours'、'address'、'location' 分類為 business（非 noise）
  rule-based.tokenizer.spec.ts
    - fallback 輸出不為空
    - 不拋例外
```

### `QueryTypeClassifier` 測試

```
src/query-understanding/classifiers/query-type.classifier.spec.ts
  - 「上班時間是幾點」→ QueryType.BusinessHours（非 Unsupported）
  - 「公司地址在哪」→ QueryType.BusinessHours 或 Contact（依 token 而定）
  - 「你們 的 螺絲 多少錢」→ QuoteRequest（product + business noise 混合，應命中 product）
  - 「可以 麻煩 請問 一下」（全 noise）→ Unsupported
  - 明確 pattern 優先於 onlyNoise 判斷（isBusinessHoursQuery 在 onlyNoise 之前）
```

### `KnowledgeAvailabilityChecker` 測試

```
src/query-understanding/classifiers/knowledge-availability-checker.spec.ts
  - business_hours queryType，KB 有對應內容 → supported
  - business_hours queryType，KB 無對應內容 → unsupported + no_kb_content_for_business_hours
  - 快取命中時不重複查詢 DB
  - KnowledgeEntry CRUD 後快取失效（若有 invalidate 機制）
```

### `QueryUnderstandingService` 測試

```
src/query-understanding/query-understanding.service.spec.ts
  - JiebaTokenizer 可用時使用 Jieba
  - JiebaTokenizer 不可用時 fallback 至 RuleBasedTokenizer
  - 英文查詢使用 EnglishTokenizer
  - zh-TW 查詢使用 zh tokenizer
  - RetrievalPlan.searchTerms 不含 noise/unknown token
  - allNoise 查詢輸出 supportability=unsupported
  - RetrievalPlan.language 始終等於傳入的 language，不為空字串
```

### `HybridRetrievalService` 測試

```
src/hybrid-retrieval/hybrid-retrieval.service.spec.ts
  - KeywordRetriever 結果正確傳遞至 FusionService
  - VectorRetriever stub 回傳 [] 時不影響結果
  - GraphRetriever stub 回傳 [] 時不影響結果
  - 去重邏輯：相同 canonical key（chunkId 或 entry:${knowledgeEntryId}）保留最高分
  - RerankerService 正確套用 term bonus
```

### No-answer Gate 測試（Hybrid + Legacy 路徑）

```
src/hybrid-retrieval/gate/retrieval-decision.service.spec.ts
  --- Hybrid path（decideFromChunks）---
  - ChunkResult[] 空陣列 → canAnswer=false, reason=no_results
  - ChunkResult[] 最高分 < minScore → canAnswer=false, reason=low_score
  - supportability=unsupported → canAnswer=false, reason=unsupportedReason
  - allNoise tokens → canAnswer=false, reason=all_tokens_noise
  - 正常命中 → canAnswer=true

  --- Legacy path（decideFromRetrievalResults）---
  - RetrievalResult[] 空陣列 → canAnswer=false, reason=no_results
  - RetrievalResult[] 最高分 < minScore → canAnswer=false, reason=low_score
  - 正常命中 → canAnswer=true

  --- understandingResult 為 undefined 時（QU V2 未啟用）---
  - 只依賴 score 判斷，不因 QU V2 關閉而讓 Gate 失效
```

### ChatPipeline 整合測試

```
src/chat/chat-pipeline.service.spec.ts（擴充既有）
  - feature flags 全部 false：行為與 002 相同
  - quV2Enabled=true：使用 QueryUnderstandingService V2
  - hybridEnabled=false, noAnswerGateEnabled=true：
      legacy path ragResults → decideFromRetrievalResults → ctx.retrievalDecision 填入
  - hybridEnabled=false, noAnswerGateEnabled=true, 無命中：
      canAnswer=false → fallback SSE，llmCalled=false（Gate 未因 hybrid=false 而失效）
  - hybridEnabled=true, noAnswerGateEnabled=true, canAnswer=false：
      回傳 fallback，llmCalled=false
  - noAnswerGateEnabled=true, canAnswer=true, answerMode=template：llmCalled=false
  - noAnswerGateEnabled=true, canAnswer=true, answerMode=llm：llmCalled=true
  - answerMode=llm 時，canAnswer=false 不得呼叫 LLM（Gate 阻擋）
  - SSE done payload 向下相容
```

### Regression 測試

沿用 002 的 regression suite 結構（`src/regression/`）：
- 20 條 zh-TW FAQ fixtures：啟用 QU V2 後，`expectedAction` 仍符合
- 10 條英文 FAQ fixtures：啟用 QU V2 後，分數仍 ≥ `rag_minimum_score`
- Jieba fallback fixtures：模擬 Jieba 初始化失敗，系統回應正常
- business_hours fixtures：啟用 QU V2 後，「上班時間是幾點」能在 KB 有內容時正常回答

---

## 13. Migration / Rollback

### Prisma Migration

建立一個加法性 migration，不修改任何現有 table：

```
prisma/migrations/
  20260429000001_add_phase3_knowledge_graph/
    migration.sql
```

`migration.sql` 內容：`CREATE TABLE knowledge_documents ...`、`CREATE TABLE knowledge_chunks ...`、`CREATE TABLE knowledge_entities ...`、`CREATE TABLE knowledge_relations ...`

不對 `knowledge_entries` 執行任何 `ALTER` 或 `DROP`。

### SystemConfig Feature Flags Seed

```typescript
// prisma/seeds/003-feature-flags.seed.ts
const flags = [
  { key: 'feature.query_understanding_v2_enabled', value: 'false' },
  { key: 'feature.zh_tokenizer', value: 'rule-based' },
  { key: 'feature.hybrid_retrieval_enabled', value: 'false' },
  { key: 'feature.no_answer_gate_enabled', value: 'false' },
  { key: 'feature.traceable_answer_enabled', value: 'false' },
];
// upsert，不覆蓋已有設定
```

### KnowledgeEntry Backfill（可選）

```bash
npx ts-node prisma/seeds/backfill-knowledge-documents.seed.ts
```

此腳本為選用，不影響主要功能。執行前後 `knowledge_entries` 資料不變。

### Feature Flag Rollback

每個 flag 可個別透過 Admin API / 直接 DB 更新回滾：

```sql
UPDATE system_configs SET value = 'false'
WHERE key IN (
  'feature.query_understanding_v2_enabled',
  'feature.hybrid_retrieval_enabled',
  'feature.no_answer_gate_enabled'
);
```

回滾後，002 路徑立即恢復，不需重新部署。

### Jieba Fallback

若 production 部署後 Jieba 初始化失敗：
1. `TokenizerProvider` 自動 fallback 至 `RuleBasedTokenizer`，WARN 日誌輸出
2. 可透過 `feature.zh_tokenizer=rule-based` 明確停用 Jieba，不需重新部署
3. AuditLog 中 `tokenizer` 欄位記錄實際使用的分詞器，便於監控

### Hybrid Retrieval Rollback

```sql
UPDATE system_configs SET value = 'false' WHERE key = 'feature.hybrid_retrieval_enabled';
```

立即切回 `PostgresRetrievalService` 路徑。

---

## 14. Risks / Open Questions

### 風險

| 風險 | 嚴重度 | 緩解措施 |
|------|--------|---------|
| `nodejieba` native addon 在 CI / Docker 無法編譯 | 高 | Dockerfile 安裝 `python3 make g++`；CI 加入編譯驗證 step；`TokenizerProvider` 強制 fallback |
| Jieba 分詞在 domain 詞彙上準確率不足（字典未補全）| 中 | Phase B 觀察 AuditLog token 分布，逐步補充 domain dictionary；Phase D 才切 jieba |
| `SupportabilityClassifier` 動態 KB 查詢增加延遲 | 中 | 結果可快取（per-queryType TTL 60s）；`debugMeta` 記錄耗時 |
| Hybrid Retrieval V1 只有 KeywordRetriever，Vector/Graph stub | 低 | 已在規格明確說明；V1 行為等同 002，無退化風險 |
| `canAnswer=false` 比率過高影響 UX | 中 | No-answer Gate 預設 false；Phase C 開啟後以 AuditLog 監控 1 週再調整閾值 |
| 大量 `KnowledgeChunk` 記錄影響 DB 效能 | 低（V1 無 backfill 要求）| V1 不強制 backfill；004+ vector search 時再評估分片策略 |

### 待決策項目

1. **Jieba 套件選型**：`nodejieba` vs `@node-rs/jieba` vs 其他具 TypeScript binding 的方案。需在 Dockerfile 測試環境驗證後決定。

2. **Domain 字典管理**：V1 使用靜態 `config/jieba-domain.txt`。是否需要在 Admin 管理介面（004+）動態更新字典，或由 `GlossaryTerm` 自動同步？

3. **`SupportabilityClassifier` 快取策略**：KB 狀態查詢的快取 TTL 建議值（60s？）及快取失效條件（KnowledgeEntry CRUD 時清除？）。

4. **`GraphRetriever` V1 實作選擇**：stub（回傳 `[]`）或 simple Postgres join？建議 V1 使用 stub，待 `KnowledgeEntity`/`KnowledgeRelation` 有真實資料後再切換。

5. **`rag_minimum_score` 與 `rag_answer_threshold` 調整**：啟用 No-answer Gate 後，現有閾值（`rag_minimum_score=0.25`）是否需要調整？建議先以現有值觀察 1 週。

6. **`ChunkResult` 與 `RetrievalResult` 長期統一**：V1 的 `ChunkResult` 與現有 `RetrievalResult` 並存。未來 `KnowledgeEntry` 完全被 `KnowledgeChunk` 取代後，可統一型別（003 範圍外）。
