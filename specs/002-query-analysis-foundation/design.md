# 震南 AI 客服後端 — 002 技術設計文件

**版本**：1.0.0 | **建立日期**：2026-04-21 | **狀態**：Draft  
**承接文件**：`specs/002-query-analysis-foundation/spec.md` v1.0.0  
**前置設計**：`specs/001-ai-chatbot-backend-system/design.md` v1.9.0

---

## 1. 文件目的

本文件定義 002 增量功能的技術方案與模組邊界。

本文件**承接** `spec.md`（002）的功能與非功能需求。  
本文件**繼承** `design.md`（001）的架構決策（§5 ~ §6），不重複描述已定案的設計。  
本文件**聚焦**在 002 新增或重構的部分：

- `QueryAnalysisModule` 的設計
- KnowledgeEntry schema 演進方案
- Intent 分層路由設計
- Template Resolver 設計
- Ranking Profile 產品化
- Admin 治理入口設計
- Diagnosis Service 初版設計
- 過渡與 rollout 策略
- 測試策略

---

## 2. 設計目標（002 補充）

| #      | 目標                                                                          |
| ------ | ----------------------------------------------------------------------------- |
| DG-2.1 | Query Analysis 以可注入模組形式存在，不以靜態 utility class 形式存在          |
| DG-2.2 | 所有 query rules / glossary / ranking weights 以 DB 為單一權威來源            |
| DG-2.3 | IQueryAnalyzer / ITokenizer 等核心介面與實作解耦，預設 rule-based，未來可替換 |
| DG-2.4 | KnowledgeEntry schema 演進以漸進 migration 方式進行，不破壞現有資料           |
| DG-2.5 | Admin 治理入口（intent / glossary / system-config）不需重啟 server 即可生效   |
| DG-2.6 | Diagnosis Service 設計適合單人開發，不過度設計狀態機                          |
| DG-2.7 | template 路徑的回答產出是 deterministic，不依賴 LLM 自由生成                  |
| DG-2.8 | 任何 002 變更不破壞 001 已通過的 94 個測試                                    |

---

## 3. 模組架構（002 新增或重構的部分）

### 3.1 新增模組一覽

```
src/
├── query-analysis/                  ← 新增模組
│   ├── query-analysis.module.ts
│   ├── query-analysis.service.ts    ← IQueryAnalyzer 預設實作協調者
│   ├── interfaces/
│   │   ├── query-analyzer.interface.ts
│   │   ├── tokenizer.interface.ts
│   │   ├── query-rule-provider.interface.ts
│   │   └── query-expansion-provider.interface.ts
│   ├── analyzers/
│   │   └── rule-based-query-analyzer.ts   ← 預設實作
│   ├── tokenizers/
│   │   └── rule-based-tokenizer.ts        ← 預設實作
│   ├── providers/
│   │   ├── db-query-rule-provider.ts      ← 從 DB 讀取 query rules
│   │   └── glossary-expansion-provider.ts ← 從 IntentService cache 展開
│   ├── types/
│   │   └── analyzed-query.type.ts
│   └── constants/
│       └── query-analysis.constants.ts
│
├── admin/
│   ├── intent/                      ← 新增
│   │   ├── admin-intent.controller.ts
│   │   ├── admin-intent.service.ts
│   │   ├── admin-intent.module.ts
│   │   └── dto/
│   │       ├── create-intent-template.dto.ts
│   │       └── update-intent-template.dto.ts
│   │
│   ├── glossary/                    ← 新增
│   │   ├── admin-glossary.controller.ts
│   │   ├── admin-glossary.service.ts
│   │   ├── admin-glossary.module.ts
│   │   └── dto/
│   │       ├── create-glossary-term.dto.ts
│   │       └── update-glossary-term.dto.ts
│   │
│   └── system-config/               ← 現有，正式落地
│       ├── admin-system-config.controller.ts  (existing)
│       └── admin-system-config.service.ts     (implement)
│
├── template/                        ← 新增
│   ├── template.module.ts
│   ├── answer-template-resolver.ts
│   ├── interfaces/
│   │   └── answer-template-resolver.interface.ts
│   └── types/
│       └── template-resolution.type.ts
│
├── diagnosis/                       ← 新增
│   ├── diagnosis.module.ts
│   ├── diagnosis.service.ts
│   ├── interfaces/
│   │   └── diagnosis-service.interface.ts
│   └── types/
│       └── diagnosis-context.type.ts
│
└── retrieval/
    └── constants/
        └── retrieval-scoring.constants.ts    ← 既有，改為從 profile 讀取
```

---

## 4. QueryAnalysisModule 設計

### 4.1 模組責任

`QueryAnalysisModule` 負責將原始使用者輸入轉換為結構化 `AnalyzedQuery`，供 `IntentService` 與 `RetrievalService` 使用。

**接受輸入**：原始 query 字串 + 語言 hint（可選）  
**產出**：`AnalyzedQuery` 物件  
**不負責**：DB 查詢（retrieval）、LLM 呼叫、HTTP context

### 4.2 核心介面設計

```typescript
// interfaces/query-analyzer.interface.ts
export interface IQueryAnalyzer {
  analyze(raw: string, language?: string): Promise<AnalyzedQuery>;
}

// interfaces/tokenizer.interface.ts
export interface ITokenizer {
  tokenize(text: string, language: string): string[];
}

// interfaces/query-rule-provider.interface.ts
export interface IQueryRuleProvider {
  getStopWords(language: string): Promise<Set<string>>;
  getNoiseWords(language: string): Promise<Set<string>>;
  getQuestionShellPatterns(language: string): Promise<RegExp[]>;
  invalidateCache(): void;
}

// interfaces/query-expansion-provider.interface.ts
export interface IQueryExpansionProvider {
  expand(terms: string[], language: string): Promise<string[]>;
}
```

### 4.3 AnalyzedQuery 輸出結構

```typescript
// types/analyzed-query.type.ts
export interface AnalyzedQuery {
  /** 原始未處理輸入 */
  rawQuery: string;

  /** 規則化後的查詢字串（替代原 QueryNormalizer.normalize() 輸出） */
  normalizedQuery: string;

  /** 偵測到的語言 */
  language: string;

  /** rule-based 分詞結果（逐字 / 逐詞切分） */
  tokens: string[];

  /** 高信心度關鍵詞（用於 multi-term reranking） */
  terms: string[];

  /** 多詞片語（例如「M3 螺絲」、「不鏽鋼螺栓」） */
  phrases: string[];

  /** 同義詞展開後的詞彙清單（來自 GlossaryTerm） */
  expandedTerms: string[];

  /** 命中的 query rule IDs（用於 observability） */
  matchedRules: string[];

  /** 所選 ranking profile key */
  selectedProfile: string;

  /** 從 query 特徵推導的 intent 候選清單（label + score） */
  intentHints: Array<{ label: string; score: number }>;

  /** 除錯用 metadata（不暴露 API response） */
  debugMeta: {
    processingMs: number;
    normalizerSteps: string[];
    expansionHits: number;
  };
}
```

### 4.4 預設實作：RuleBasedQueryAnalyzer

```
輸入: raw string + language
  │
  ├─[Step 1] 語言偵測（若無 hint）
  │            → 沿用 QueryNormalizer.detectLang() 邏輯
  │
  ├─[Step 2] Full-width → half-width 正規化
  │
  ├─[Step 3] Question-shell 去除
  │            → 從 DbQueryRuleProvider.getQuestionShellPatterns() 取得 patterns
  │            → 若無 DB patterns，fallback 到 hardcoded（向後相容）
  │
  ├─[Step 4] Stop words / noise words 過濾
  │            → 從 DbQueryRuleProvider.getStopWords() 取得
  │
  ├─[Step 5] Tokenization
  │            → RuleBasedTokenizer（以標點 / 空白為分隔）
  │
  ├─[Step 6] Term extraction（高信心度詞彙）
  │            → 長度 ≥ 2（中文）/ stop-word filter（英文）
  │
  ├─[Step 7] Phrase detection（相鄰 term 組合）
  │            → 滑動視窗，bi-gram 中文 / bi-gram 英文
  │
  ├─[Step 8] Glossary expansion
  │            → GlossaryExpansionProvider 展開 terms → expandedTerms
  │
  ├─[Step 9] Profile selection
  │            → 基於 intentHints + query 特徵選取 profile key
  │
  └─[Step 10] 輸出 AnalyzedQuery
```

### 4.5 Profile Selection 邏輯

```
if intentHints 中有 'diagnosis' 類 intent:
    selectedProfile = 'diagnosis'
elif query 含有 FAQ 問法模式（有 question-shell + 疑問詞）:
    selectedProfile = 'faq'
elif query 全部由 product terms 組成（無問法結構）:
    selectedProfile = 'product'
else:
    selectedProfile = 'default'
```

Profile 可由 SystemConfig `feature.profile_selection_mode` 覆蓋為 `static`（固定使用 `default`），作為 rollout 安全閥。

### 4.6 與 Chat Pipeline 的整合

```
ChatPipelineService.run()
  │
  ├─ [Step 1] Input validation
  ├─ [Step 2] Language detection  ←── 002: 改由 QueryAnalysisService 統一處理
  ├─ [Step 3] Safety guard
  ├─ [Step 4] Confidentiality check
  ├─ [Step 5-new] QueryAnalysisService.analyze()   ←── 002 新增步驟
  │               → 產出 analyzedQuery
  │               → 取代原本的 QueryNormalizer.normalize() 呼叫
  ├─ [Step 6] Intent detection    ←── 002: 傳入 analyzedQuery
  ├─ [Step 7] RAG retrieval       ←── 002: 傳入 analyzedQuery（含 terms / profile）
  ├─ [Step 8] Confidence evaluation
  ├─ [Step 9] Template resolution ←── 002 新增步驟
  │               → AnswerTemplateResolver.resolve()
  │               → 決定 template / rag+template / rag / llm 路徑
  ├─ [Step 10] Build prompt
  ├─ [Step 11] Stream LLM response（僅在 rag 或 llm 路徑）
  └─ [Step 12] Persist + close stream
```

**向後相容設計**：Chat Pipeline 中保留 feature flag `feature.query_analysis_enabled`；若為 `false`，fallback 至原 `QueryNormalizer.normalize()` 邏輯（001 行為不變）。

---

## 5. KnowledgeEntry Schema 演進設計

### 5.1 新增欄位方案

| 欄位                    | 類型       | 用途                                                                     | Default / Constraint            |
| ----------------------- | ---------- | ------------------------------------------------------------------------ | ------------------------------- |
| `sourceKey`             | `String?`  | 穩定業務識別鍵（slug）                                                   | nullable；同語言下 unique       |
| `category`              | `String?`  | 業務分類（`product-spec`/`faq-general`/`pricing`/`contact`/`diagnosis`） | nullable                        |
| `answerType`            | `String`   | 回答策略（`template`/`rag+template`/`rag`/`llm`）                        | default `'rag'`（001 現行行為） |
| `templateKey`           | `String?`  | 指向 template registry key                                               | nullable                        |
| `faqQuestions`          | `String[]` | 明確的 FAQ 問句變體                                                      | default `[]`                    |
| `crossLanguageGroupKey` | `String?`  | 跨語系配對 group key                                                     | nullable                        |
| `structuredAttributes`  | `Json?`    | 產品規格屬性（JSONB）                                                    | nullable                        |

### 5.2 責任邊界重新定義

```
aliases         → retrieval ILIKE 命中用（自然語言 phrasing，不含完整問句）
tags            → 產品關鍵字 / 規格識別符（不含完整問句）
faqQuestions    → 完整 FAQ 問句形式（「如何申請退貨？」等）
category        → 業務分類（取代靠 tags 隱含分類的做法）
```

### 5.3 Prisma Schema 更新

```prisma
model KnowledgeEntry {
  // ... 現有欄位不動 ...

  /// 穩定業務識別鍵，例如 "screw-m3-specification"。同語言下唯一。
  sourceKey             String?
  /// 業務分類：product-spec | faq-general | pricing | contact | diagnosis
  category              String?
  /// 回答策略：template | rag+template | rag | llm
  answerType            String  @default("rag")
  /// 指向 template registry 的 key（answerType 含 template 時使用）
  templateKey           String?
  /// 明確的 FAQ 問句變體（區別於 aliases 的 ILIKE phrasings）
  faqQuestions          String[] @default([])
  /// 跨語系配對 group key
  crossLanguageGroupKey String?
  /// 產品規格屬性 JSONB（供 Phase 4 問診比對）
  structuredAttributes  Json?

  @@unique([sourceKey, language])
  @@map("knowledge_entries")
}
```

### 5.4 Migration 策略

- **非破壞性**：所有新欄位均為 nullable 或有 default（`answerType` default `'rag'`）
- **漸進填充**：既有條目 migration 後 `answerType='rag'`（001 行為不變）
- **Seed 更新**：所有種子資料遷移至使用 `sourceKey` 做 upsert（`upsert where: { sourceKey, language }`）
- **Backward compat**：`answerType='rag'` 等於 001 的預設行為，Pipeline 邏輯不變

---

## 6. Ranking Profile 產品化設計

### 6.1 Profile 資料結構

Ranking profile 以 SystemConfig keys 的命名規範儲存，格式為：

```
ranking.<profileKey>.<fieldKey> = <value>
```

例如：

```
ranking.default.title_boost = 1.2
ranking.default.alias_ilike_bonus = 0.10
ranking.default.tag_ilike_bonus = 0.05
ranking.default.trgm_threshold = 0.10
ranking.faq.title_boost = 1.0
ranking.faq.alias_ilike_bonus = 0.20
ranking.faq.tag_ilike_bonus = 0.03
ranking.diagnosis.title_boost = 1.0
ranking.diagnosis.tag_ilike_bonus = 0.15
ranking.diagnosis.alias_ilike_bonus = 0.05
```

### 6.2 Profile Provider 設計

```typescript
export interface IRetrievalRankProfileProvider {
  getProfile(profileKey: string): Promise<RankingProfile>;
  getDefaultProfile(): Promise<RankingProfile>;
}

export interface RankingProfile {
  profileKey: string;
  titleBoost: number;
  aliasIlikeBonus: number;
  tagIlikeBonus: number;
  trgmThreshold: number;
  contentWeight: number;
}
```

預設實作：`SystemConfigRankProfileProvider`，從 `SystemConfigService` 讀取，fallback 到 `RETRIEVAL_SCORING` 靜態常數（向後相容）。

### 6.3 RetrievalService 整合

`PostgresRetrievalService.retrieve()` 接受 `AnalyzedQuery.selectedProfile` 作為 profile 選取依據：

```typescript
async retrieve(query: RetrievalQuery): Promise<RetrievalResult[]> {
  const profile = await this.rankProfileProvider.getProfile(
    query.selectedProfile ?? 'default'
  );
  // 使用 profile.titleBoost / aliasIlikeBonus 等替代 RETRIEVAL_SCORING 靜態常數
}
```

**向後相容**：若 SystemConfig 無對應 key，fallback 至現有 `RETRIEVAL_SCORING` 常數值（不 breaking）。

---

## 7. Intent 分層路由設計

### 7.1 現有限制

001 `IntentService.detect()` 的限制：

1. 僅 substring keyword match，精度有限
2. Glossary expansion 只展開給 IntentService 內部，retrieval 看不到
3. 無 intentHints 先驗候選，每次從頭掃全部 templates
4. 無 category fallback 路徑

### 7.2 三層分流架構

```
IntentService.detect(input, language, analyzedQuery?)
  │
  ├─[Layer 1] IntentHints 快速路徑
  │    if analyzedQuery.intentHints.length > 0:
  │      取最高 score 的 hint → 如果 score > HINT_CONFIDENCE_THRESHOLD
  │        → return 直接採用
  │
  ├─[Layer 2] ExpandedTerms Template Matching
  │    使用 analyzedQuery.expandedTerms（含同義詞展開）
  │    對 templates 做 keyword matching（現有邏輯升級版）
  │    → 命中 → return
  │
  ├─[Layer 3] Category Fallback
  │    若 RAG 命中的 KnowledgeEntry 有明確 category：
  │      category → intentLabel 推導（靜態 mapping）
  │    → 命中 → return
  │
  └─ 無命中 → return { intentLabel: null, confidence: 0 }
```

**注意**：Layer 3 需要 RAG 結果，因此 intent 最終確認發生在 RAG 之後（SSE done event 中的 `intentLabel` 反映此最終值）。Layer 1/2 在 RAG 之前執行（quick pass），Layer 3 為補充。

### 7.3 Intent Template 新增欄位

```prisma
model IntentTemplate {
  // ... 現有欄位 ...
  isActive    Boolean @default(true)   ← 新增：可停用個別 template
  category    String?                  ← 新增：對應 KnowledgeEntry.category
}
```

### 7.4 Category → Intent 靜態 Mapping

```typescript
const CATEGORY_TO_INTENT: Record<string, string> = {
  'product-spec': 'product-inquiry',
  pricing: 'pricing-inquiry',
  contact: 'contact-inquiry',
  'faq-general': 'general-faq',
  diagnosis: 'product-diagnosis',
};
```

此 mapping 為初始靜態定義，後續可移至 DB（IntentTemplate.category 欄位）。

---

## 8. Template Resolver 設計

### 8.1 AnswerTemplateResolver 責任

`AnswerTemplateResolver` 負責根據以下輸入決定回答路徑：

- `KnowledgeEntry.answerType`（若有 RAG 命中）
- `IntentTemplate.templateZh` / `templateEn`（若有 intent 命中）
- `AnalyzedQuery.language`

### 8.2 TemplateResolution 輸出結構

```typescript
export interface TemplateResolution {
  /** 決定的回答路徑 */
  strategy: 'template' | 'rag+template' | 'rag' | 'llm';

  /** template 路徑時，填好的最終回覆文字 */
  resolvedContent?: string;

  /** 選擇此路徑的理由（用於 debug / audit） */
  reason: string;
}
```

### 8.3 策略決定邏輯

```
resolve(ragResults, intentLabel, language):

  if ragResults.length > 0 AND ragResults[0].entry.answerType === 'template':
    → 直接從 ragResults[0].entry 取 content 作為 resolvedContent（deterministic）
    → strategy = 'template'

  elif ragResults.length > 0 AND ragResults[0].entry.answerType === 'rag+template':
    → 將 ragResults[0].entry.content 填入 IntentTemplate.templateZh/En
    → strategy = 'rag+template'

  elif ragResults.length > 0:
    → strategy = 'rag'（現有 RAG + LLM 路徑，001 行為不變）

  else:
    → strategy = 'llm'（現有 fallback，001 行為不變）
```

### 8.4 Chat Pipeline 整合

```typescript
// Pipeline Step 9（新增）
const templateResolution = await this.templateResolver.resolve(
  ctx.ragResults,
  ctx.intentLabel,
  ctx.language,
);

if (templateResolution.strategy === 'template') {
  // 直接寫入 resolvedContent，跳過 Step 10/11（LLM 呼叫）
  res.write(formatSseEvent('token', { token: templateResolution.resolvedContent! }));
  // ... 寫入 done event, persist ...
  return;
}

if (templateResolution.strategy === 'rag+template') {
  // 填入 template 後直接回傳，跳過 LLM
  // ...
  return;
}

// strategy === 'rag' or 'llm' → 走現有 Step 10/11 LLM 路徑
```

---

## 9. AdminSystemConfig 落地設計

### 9.1 現有問題

`AdminSystemConfigService` 目前方法全是 `throw new NotImplementedException()`。

### 9.2 實作方案

```typescript
@Injectable()
export class AdminSystemConfigService {
  constructor(
    private readonly systemConfigRepository: SystemConfigRepository,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  async findAll(): Promise<SystemConfig[]> {
    return this.systemConfigRepository.findAll();
  }

  async upsert(key: string, value: string): Promise<SystemConfig> {
    const result = await this.systemConfigRepository.upsert(key, value);
    this.systemConfigService.invalidateCache();
    return result;
  }

  async findByKey(key: string): Promise<SystemConfig | null> {
    return this.systemConfigRepository.findByKey(key);
  }
}
```

### 9.3 Cache Invalidation 設計

`SystemConfigService` 新增 `invalidateCache()` 方法，清除 in-memory cache 並重新從 DB 載入。

呼叫鏈：

```
AdminSystemConfigController.update()
  → AdminSystemConfigService.upsert()
  → SystemConfigService.invalidateCache()     ← 立即生效
  → 下一次 getNumber() / getString() 使用新值
```

---

## 10. Admin 治理入口設計

### 10.1 admin/intent/\* API

```
GET    /api/v1/admin/intent            → 列出所有 IntentTemplate
POST   /api/v1/admin/intent            → 建立新 IntentTemplate
GET    /api/v1/admin/intent/:id        → 取得單一 IntentTemplate
PATCH  /api/v1/admin/intent/:id        → 更新 IntentTemplate
DELETE /api/v1/admin/intent/:id        → 停用 IntentTemplate（soft disable: isActive=false）
POST   /api/v1/admin/intent/cache/invalidate → 手動觸發 cache reload
```

**設計要點**：

- DELETE 為邏輯刪除（設定 `isActive=false`），不實體刪除（避免誤刪影響稽核）
- 每次 CREATE / UPDATE / DELETE 自動觸發 `IntentService.invalidateCache()`
- `isActive=false` 的 template 在 detect() 時跳過

### 10.2 admin/glossary/\* API

```
GET    /api/v1/admin/glossary          → 列出所有 GlossaryTerm
POST   /api/v1/admin/glossary          → 建立新 GlossaryTerm
GET    /api/v1/admin/glossary/:id      → 取得單一 GlossaryTerm
PATCH  /api/v1/admin/glossary/:id      → 更新 GlossaryTerm
DELETE /api/v1/admin/glossary/:id      → 刪除 GlossaryTerm
POST   /api/v1/admin/glossary/cache/invalidate → 手動觸發 cache reload
```

**設計要點**：

- GlossaryTerm 刪除為實體刪除（glossary 是配置資料，不是業務資料）
- 每次 mutate 操作自動觸發 `IntentService.invalidateCache()`

### 10.3 admin/system-config/\* API（落地）

```
GET    /api/v1/admin/system-config     → 列出所有 SystemConfig（不暴露敏感值）
GET    /api/v1/admin/system-config/:key → 取得單一 key 的值
PATCH  /api/v1/admin/system-config/:key → 更新單一 key 的值（自動 invalidate cache）
```

**設計要點**：

- PATCH 採 upsert 語意（key 不存在則建立）
- 觸發 `SystemConfigService.invalidateCache()`

---

## 11. Diagnosis Service 初版設計

### 11.1 責任邊界

`DiagnosisService` 負責：

1. 讀取 `Conversation.diagnosisContext`（透過 `ConversationRepository`）
2. 管理問診狀態（已問問題、蒐集到的答案、問診完成狀態）
3. 提供 `getNextQuestion()` / `recordAnswer()` / `isComplete()` 介面
4. **不負責** Chat Pipeline 的 SSE 寫入邏輯（那是 Pipeline 的責任）
5. **不負責** intent 偵測（那是 IntentService 的責任）

### 11.2 DiagnosisContext 結構

```typescript
export interface DiagnosisContext {
  /** 問診流程 ID（對應 IntentTemplate 或 diagnosis config key） */
  flowId: string;

  /** 目前問診進度（已問過的問題 index） */
  currentStep: number;

  /** 尚待詢問的問題欄位清單 */
  pendingQuestions: DiagnosisQuestion[];

  /** 已蒐集的答案 */
  collectedAnswers: Record<string, string>;

  /** 問診是否完成 */
  isComplete: boolean;
}

export interface DiagnosisQuestion {
  /** 欄位識別符（如 'material_preference', 'size_range'） */
  fieldKey: string;

  /** 問句（zh-TW） */
  questionZh: string;

  /** 問句（en） */
  questionEn: string;

  /** 是否必填 */
  required: boolean;
}
```

### 11.3 DiagnosisService 介面

```typescript
export interface IDiagnosisService {
  /** 取得下一個待問問題，null 表示問診完成或尚未初始化 */
  getNextQuestion(conversationId: number, language: string): Promise<DiagnosisQuestion | null>;

  /** 記錄某個問題的答案 */
  recordAnswer(conversationId: number, fieldKey: string, answer: string): Promise<void>;

  /** 問診是否完成 */
  isComplete(conversationId: number): Promise<boolean>;

  /** 初始化問診流程 */
  initFlow(conversationId: number, flowId: string, questions: DiagnosisQuestion[]): Promise<void>;

  /** 取得目前所有已蒐集的答案 */
  getCollectedAnswers(conversationId: number): Promise<Record<string, string>>;
}
```

### 11.4 與 ConversationService 的關係

`DiagnosisService` 不直接操作 Prisma，改透過 `ConversationService.updateDiagnosisContext()` / `getDiagnosisContext()` 方法讀寫 `Conversation.diagnosisContext` JSONB。

```
DiagnosisService
  → ConversationService.getDiagnosisContext(conversationId)
  → ConversationService.updateDiagnosisContext(conversationId, context)
```

### 11.5 Phase 4 前置說明

002 的 DiagnosisService 是初版基礎：

- 實作 IDiagnosisService 介面與 JSONB 讀寫
- Unit test 覆蓋狀態機轉換邏輯
- **Phase 4 直接在此基礎上擴充** DiagnosisFlow 設定來源（從 IntentTemplate 取 diagnosis questions）
- Phase 4 的 Chat Pipeline 整合在 `feat/phase-4` 中進行，不在 002

---

## 12. Rollout / Migration 策略

### 12.1 從 QueryNormalizer 過渡到 QueryAnalysisModule

**策略**：Feature flag + fallback  
**步驟**：

1. 建立 `QueryAnalysisModule`，保留 `QueryNormalizer` 不刪除
2. Chat Pipeline 新增 feature flag 判斷：
   ```typescript
   const useQueryAnalysis =
     this.systemConfigService.getBoolean('feature.query_analysis_enabled') ?? false;
   const analyzed = useQueryAnalysis
     ? await this.queryAnalysisService.analyze(input, language)
     : legacyNormalize(input, language);
   ```
3. 初始部署時 `feature.query_analysis_enabled=false`（001 行為）
4. 執行 regression fixtures，確認命中率不退步
5. 設定 `feature.query_analysis_enabled=true`
6. 觀察 3 天，確認無退步
7. 移除 feature flag（下一個 minor release）

### 12.2 從現有 IntentService 過渡到三層路由

**策略**：向後相容擴充（不 breaking）  
**步驟**：

1. `detect()` 方法新增 `analyzedQuery?` 可選參數
2. 若有 `analyzedQuery`，走三層路由；若無，走原有行為
3. Chat Pipeline 在 QueryAnalysis 可用後傳入 `analyzedQuery`
4. 無需 feature flag（新參數為可選，舊呼叫路徑不受影響）

### 12.3 KnowledgeEntry Schema Migration

**策略**：漸進非破壞式 migration  
**步驟**：

1. 新增欄位 migration（所有欄位 nullable 或有 default）
2. 既有資料：`answerType='rag'`（default），其他欄位 null
3. Seed 腳本更新為使用 `sourceKey` upsert
4. Admin DTO 新增新欄位（可選參數）
5. 現有 001 tests 不受影響（新欄位不改變 API response 結構）

### 12.4 Ranking Profile 過渡

**策略**：SystemConfig key 預設等於現有靜態常數值  
**步驟**：

1. `SystemConfigRankProfileProvider.getProfile()` 若無對應 key，fallback 到 `RETRIEVAL_SCORING`
2. Admin 可透過 SystemConfig API 新增 profile keys，override 靜態值
3. 原 `RETRIEVAL_SCORING` 常數保留（作為 fallback，後續 deprecate）

### 12.5 Regression Safety 設計

```
golden-fixtures/
├── faq-zh.fixtures.ts      ← 20 筆常用 zh-TW FAQ 問法
├── faq-en.fixtures.ts      ← 10 筆常用 en FAQ 問法
├── intent.fixtures.ts      ← 5+ 種 intent 測試案例
└── template.fixtures.ts    ← template 選取測試案例

測試流程：
1. 每次修改 query rules / ranking weights / glossary 後執行 regression suite
2. 每筆 fixture 驗證 top-3 命中包含期望的 knowledge entry（以 sourceKey 識別）
3. CI 強制通過此 suite，防止退步 merge
```

---

## 13. Observability 設計

### 13.1 AuditLog 新增欄位

```prisma
model AuditLog {
  // ... 現有欄位 ...

  /// 本次選取的 ranking profile key（query analysis 結果）
  selectedProfile    String?

  /// 命中的 query rules（JSON array of rule IDs）
  matchedQueryRules  String[] @default([])

  /// 抽取的 terms（JSON array of strings）
  extractedTerms     String[] @default([])

  /// Query Analysis 處理時間（毫秒）
  queryAnalysisMs    Int?

  /// Template 回答策略（若本次走 template 路徑）
  templateStrategy   String?
}
```

### 13.2 Observability 邊界原則

- `matchedQueryRules` / `selectedProfile` / `extractedTerms`：寫入 AuditLog，**不出現在 SSE API response**
- `debugMeta.processingMs`：寫入 AuditLog，不出現在 API response
- Template 選取理由：寫入 AuditLog，不出現在 API response
- 前端 SSE `event: done` 只包含 `intentLabel`（001 已有）

---

## 14. 測試策略（002）

### 14.1 Unit Tests

| 測試對象                    | 測試重點                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `RuleBasedQueryAnalyzer`    | 各 step 的輸出正確性（normalize / tokens / terms / phrases / expandedTerms / profile selection） |
| `DbQueryRuleProvider`       | cache 讀取 / invalidation                                                                        |
| `GlossaryExpansionProvider` | 同義詞展開正確性                                                                                 |
| `IntentService`（三層路由） | Layer 1/2/3 各自命中與 fallback 行為                                                             |
| `AnswerTemplateResolver`    | 4 種 answerType 的 strategy 決定邏輯                                                             |
| `DiagnosisService`          | getNextQuestion / recordAnswer / isComplete 狀態機轉換                                           |
| `AdminSystemConfigService`  | upsert + cache invalidation                                                                      |
| `AdminIntentService`        | CRUD + cache invalidation                                                                        |
| `AdminGlossaryService`      | CRUD + cache invalidation                                                                        |

### 14.2 Regression Tests（Golden Fixtures）

```typescript
describe('FAQ regression fixtures', () => {
  it.each(FAQ_ZH_FIXTURES)(
    'should hit expected entry for: %s',
    async (query, expectedSourceKey) => {
      const results = await retrievalService.retrieve({ query, language: 'zh-TW' });
      expect(results.slice(0, 3).map(r => r.entry.sourceKey)).toContain(expectedSourceKey);
    },
  );
});
```

### 14.3 Integration Tests

- Query Analysis → Retrieval 端對端（mock DB）
- Chat Pipeline template 路徑（mock TemplateResolver）
- Admin API → cache invalidation → 下一次 detect() 反映新 template

### 14.4 Backward Compatibility Tests

- 執行全部 001 tests（94 tests）並確認全數通過
- Schema migration：`answerType='rag'` 既有條目行為不變
- Pipeline：`feature.query_analysis_enabled=false` 時行為與 001 完全一致

---

## 15. 模組依賴關係（002 新增部分）

```
QueryAnalysisModule
  ├── depends on: PrismaModule（DbQueryRuleProvider）
  └── depends on: IntentModule（GlossaryExpansionProvider 讀 glossary cache）

TemplateModule
  ├── depends on: KnowledgeModule（讀取 KnowledgeEntry.answerType）
  └── depends on: IntentModule（讀取 IntentTemplate.templateZh/En）

DiagnosisModule
  └── depends on: ConversationModule（diagnosisContext 讀寫）

AdminIntentModule
  └── depends on: IntentModule（IntentService.invalidateCache）

AdminGlossaryModule
  └── depends on: IntentModule（IntentService.invalidateCache）

AdminSystemConfigModule
  └── depends on: SystemConfigModule（SystemConfigService.invalidateCache）

ChatModule（002 更新後）
  ├── depends on: QueryAnalysisModule（新增）
  ├── depends on: TemplateModule（新增）
  └── depends on: DiagnosisModule（新增）
```

---

## 16. 開放問題（Open Questions）

| #    | 問題                                                      | 保守預設                                                                  |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| OQ-1 | query rules DB table 是新增還是沿用 SystemConfig？        | 新增 `query_rules` table（區分責任邊界）                                  |
| OQ-2 | Template registry 是獨立 table 還是延用 IntentTemplate？  | 002 沿用 IntentTemplate.templateZh/En；Phase 4 再評估是否獨立             |
| OQ-3 | Glossary expansion 是在 QueryAnalysis 還是 Retrieval 做？ | QueryAnalysis 做展開，Retrieval 使用展開結果（避免重複計算）              |
| OQ-4 | AnalyzedQuery 是否需要傳遞到 AuditLog？                   | 傳遞 selectedProfile + extractedTerms + matchedQueryRules（不傳完整物件） |
| OQ-5 | structuredAttributes JSONB 的 schema 如何定義？           | Phase 4 前保持 untyped Json；Phase 4 定義正式 schema                      |
