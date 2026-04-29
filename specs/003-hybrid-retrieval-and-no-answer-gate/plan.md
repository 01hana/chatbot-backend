# 實作計畫：混合式檢索與無答案閘門

**功能分支**：`003-hybrid-retrieval-no-answer-gate`  
**建立日期**：2026-04-29  
**狀態**：草稿  
**前置功能**：002-query-analysis-foundation  
**對應規格**：[spec.md](./spec.md)  
**技術設計**：[design.md](./design.md)

---

## 目錄

1. [Implementation Overview](#1-implementation-overview)
2. [Technical Context](#2-technical-context)
3. [Architecture Impact](#3-architecture-impact)
4. [Data Model Plan](#4-data-model-plan)
5. [Integration Plan](#5-integration-plan)
6. [Testing Plan](#6-testing-plan)
7. [Rollout Plan](#7-rollout-plan)
8. [Migration and Rollback Plan](#8-migration-and-rollback-plan)
9. [Risks and Mitigations](#9-risks-and-mitigations)
10. [Open Questions](#10-open-questions)
11. [Acceptance Examples](#11-acceptance-examples)

---

## 1. Implementation Overview

003 以 **additive / feature-flagged rollout** 方式落地，所有新功能預設為 `false`。003 程式碼合併後，若全部 feature flags 維持預設，系統行為與 002 完全相同，現有 baseline test suite 無需修改即全數通過（SC-007）。

### 核心交付範圍

| 交付項目 | 說明 |
|---------|------|
| Query Understanding V2 | `QueryUnderstandingModule`：JiebaTokenizer / EnglishTokenizer / RuleBasedTokenizer fallback chain，`QueryTypeClassifier`，`SupportabilityClassifier`，`KnowledgeAvailabilityChecker`，`RetrievalPlanBuilder` |
| Hybrid Retrieval V1 | `HybridRetrievalModule`：`KeywordRetriever`（主要可用 retriever），`VectorRetriever` interface + stub，`GraphRetriever` interface + stub 或 simple Postgres join，`RetrievalFusionService`，`RerankerService` |
| No-answer Gate | `RetrievalDecisionService`：在 LLM 呼叫前強制執行 `canAnswer` 檢查，支援 hybrid 與 legacy 兩條輸入路徑 |
| Traceable Answer | `GeneratedAnswer` 含 `sourceReferences`（始終存在）、`answerMode`（5 種）、`trace`（feature flag 控制） |
| Additive Prisma Schema | `KnowledgeDocument` / `KnowledgeChunk` / `KnowledgeEntity` / `KnowledgeRelation`，不修改 `knowledge_entries` |
| AuditLog V2 | 加法性擴充欄位，不刪除現有欄位 |

### 不在 003 範圍

- 完整 Microsoft-style GraphRAG（community detection、community summary、多跳 graph traversal）
- Neo4j 或外部圖資料庫
- pgvector embedding 生成與正式 vector search（`VectorRetriever` stub 即可）
- Knowledge Graph Admin UI
- Jieba 字典管理 UI
- KnowledgeEntry → Document/Chunk 強制 backfill（可選 script，不為 blocking deliverable）
- 完整 Admin document upload / chunk 編輯 UI

### 相容性承諾

- 001 SSE 路由不變：`POST /api/v1/chat/sessions/:sessionToken/messages`
- SSE event schema 向下相容；`sourceReferences` / `trace` 為加法性新增
- 002 `QueryAnalysisService`、`AnswerTemplateResolver`、`DiagnosisService` 均保留，不修改
- 既有 Admin Knowledge API 保留
- `KnowledgeEntry` 不執行破壞性 migration

### 實作階段概覽

| Phase | 內容 |
|-------|------|
| 0 | Schema migration + Feature flags seed + Module scaffolding |
| 1 | QueryUnderstanding V2 核心型別與服務 |
| 2 | Tokenizer 實作（JiebaTokenizer / EnglishTokenizer / RuleBasedTokenizer） |
| 3 | Hybrid Retrieval V1（KeywordRetriever + stubs + Fusion + Reranker） |
| 4 | No-answer Gate + ChatPipeline integration |
| 5 | Traceability / AuditLog V2 |
| 6 | Regression 驗收 + Rollout hardening |

---

## 2. Technical Context

### Backend Stack

| 項目 | 說明 |
|------|------|
| Framework | NestJS 10+，TypeScript strict mode |
| ORM | Prisma（`@prisma/adapter-pg`），generated client at `src/generated/prisma` |
| Database | PostgreSQL `127.0.0.1:5434`，database `chatbot` |
| Validation | `class-validator` + `class-transformer` |
| Testing | Jest，`rootDir: "src"`，`testRegex: ".*\\.spec\\.ts$"` |
| SSE | Express `Response` 物件直接寫入 |

### 現有服務（保留不破壞）

| 服務 | 位置 | 003 中的角色 |
|------|------|-------------|
| `ChatPipelineService` | `src/chat/` | 擴充 Step 2.5 / 6 / 6.5 / 11；其餘 steps 不動 |
| `PostgresRetrievalService` | `src/retrieval/` | Legacy path 保留；**不得加入** 分詞 / QU 邏輯 |
| `QueryAnalysisService` | existing 002 module path（以目前專案實際路徑為準） | 作為 fallback path 保留；**不搬移、不覆蓋**；002 行為不變 |
| `AnswerTemplateResolver` | `src/admin/`（002）| 保留；Step 9 不變 |
| `DiagnosisService` | 002 | 保留不改 |
| `SystemConfigService` | `src/system-config/` | 讀取所有 feature flags |
| `AuditService` | `src/audit/` | 加法性擴充 V2 欄位 |
| `IntentService` | `src/intent/` | 不變；`QueryUnderstandingResult.intentCandidates` 預留欄位供下游使用 |
| `SafetyService` | `src/safety/` | Steps 3–4 不變 |
| `LlmModule` | `src/llm/` | 不變；Step 10 呼叫條件加嚴（須 `canAnswer=true`） |

### 新增模組

| 模組 | 位置 | 說明 |
|------|------|------|
| `QueryUnderstandingModule` | `src/query-understanding/`（V2，003 新增） | QU V2 完整服務群組 |
| `HybridRetrievalModule` | `src/hybrid-retrieval/` | Hybrid retrieval + No-answer Gate |

> **路徑衝突預防**：003 新增 `QueryUnderstandingModule` 時，**不得覆蓋、搬移或改名**既有 002 `QueryAnalysisService`。若實際專案中 002 已使用 `src/query-understanding/`，003 V2 模組應使用不衝突的目錄（例如 `src/query-understanding-v2/`，或在既有目錄下以子目錄隔離）。若存在路徑命名衝突，task.md 必須明確拆分 002 fallback path 與 003 Query Understanding V2 path，並說明共存策略，不得合併或取代。

### Feature Flags（`SystemConfig` key/value）

| Key | 型別 | 預設值 | 說明 |
|-----|------|--------|------|
| `feature.query_understanding_v2_enabled` | boolean | `false` | 啟用 QU V2 管線 |
| `feature.zh_tokenizer` | string | `rule-based` | `rule-based` 或 `jieba` |
| `feature.hybrid_retrieval_enabled` | boolean | `false` | 啟用 `HybridRetrievalService` |
| `feature.no_answer_gate_enabled` | boolean | `false` | 啟用 No-answer Gate |
| `feature.traceable_answer_enabled` | boolean | `false` | 啟用 `trace` 欄位及 chunk-level metadata |

### 外部依賴

- **Jieba npm package**：候選為 `nodejieba` 或 `@node-rs/jieba`（最終選型為 Open Question）。涉及 native C++ addon，Dockerfile 需確保 `python3 make g++` 存在；CI pipeline 需在 build stage 驗證 Jieba 能正常安裝與初始化。`TokenizerProvider` 在 Jieba 不可用時必須靜默 fallback。

---

## 3. Architecture Impact

### 3.1 QueryUnderstandingModule（新增）

**路徑**：`src/query-understanding/`（V2 目錄結構，與現有 002 `QueryAnalysisService` 並存）

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
    knowledge-availability-checker.ts
  builders/
    retrieval-plan.builder.ts
  types/
    token-type.enum.ts
    query-type.enum.ts
    query-token.type.ts
    query-understanding-result.type.ts
    retrieval-plan.type.ts
```

#### 服務職責

**`QueryUnderstandingService`**
- 接收 `(rawQuery: string, language: string)`，返回 `QueryUnderstandingResult`
- 協調 normalize → tokenize → classify queryType → classify supportability → build retrieval plan
- 記錄 `debugMeta`（各步驟耗時）

**`TokenizerProvider`**
- 依 `language` 與 `feature.zh_tokenizer` 選擇分詞器
- Jieba 不可用時靜默 fallback 至 `RuleBasedTokenizer`，輸出 WARN 日誌，**不得拋出例外**
- 暴露 `getLastUsedName()` 供 `QueryUnderstandingResult.tokenizer` 記錄

**`ITokenizer`（interface）**
- `tokenize(text: string, language: string): Promise<QueryToken[]>`

**`JiebaTokenizer`**
- 實作 `ITokenizer` + `OnModuleInit`
- `onModuleInit()` 動態 require Jieba，失敗時標記 `_ready = false`，輸出 WARN，不拋例外
- 支援 domain dictionary（`config/jieba-domain.txt`）
- 正確保留 `304`、`316`、`M3`、`M4` 等規格 token（Spec 類型）
- 將「上班時間 / 營業時間 / 公司地址」分類為 `Business`，**非** `Noise`
- 所有 token 輸出 `source: 'jieba'`（dictionary 命中時 `'dictionary'`，GlossaryTerm 匹配時 `'glossary'`）

**`EnglishTokenizer`**
- 實作 `ITokenizer`
- lowercasing、punctuation cleanup、stop words 過濾（what、how、can、please 等）
- 產品詞（screw、bolt、nut）→ `Product`
- 商務詞（quote、catalog、hours、address、location）→ `Business`（**非** `Noise`）
- 聯絡詞（contact、email、phone）→ `Contact`
- 規格 pattern（304、316、M3、ISO）→ `Spec`
- 尺寸 pattern（10mm、3cm）→ `Dimension`
- 所有 token 輸出 `source: 'english'`

**`RuleBasedTokenizer`**
- 沿用 002 `RuleBasedQueryAnalyzer` bi-gram / sliding window 邏輯，包裝為 `ITokenizer`
- 所有 token 輸出 `source: 'rule-based'`
- 為 fallback only；tokenType 分類較粗糙，但確保管線不斷路

**`QueryTypeClassifier`**
- 純同步，不查 DB
- 判斷順序（由高優先到低優先）：
  1. `hasContact` → `Contact`
  2. `isBusinessHoursQuery(normalizedQuery)` → `BusinessHours`（**必須在 `hasBusiness` 之前**，防止「上班時間」誤判為 `QuoteRequest`）
  3. `hasBusiness && isCatalogQuery` → `CatalogDownload`
  4. `hasBusiness` → `QuoteRequest`
  5. `hasProduct && isComparisonQuery` → `ProductComparison`
  6. `hasProduct || hasMaterial` → `ProductLookup`
  7. `onlyNoise` → `Unsupported`
  8. `Unknown`

**`SupportabilityClassifier`**
- 非同步，簽名：`classify(queryType, tokens, language)`
- 先快速判斷 all-noise → `unsupported`
- 再查 `KnowledgeAvailabilityChecker.hasContentFor(queryType, language)`
- 結果：`{ supportability: 'supported' | 'unsupported' | 'unknown', unsupportedReason? }`

**`KnowledgeAvailabilityChecker`**
- 非同步，查詢 `KnowledgeEntry`（V1）及 `KnowledgeDocument`（V2）
- 篩選條件：`status='approved'`, `visibility='public'`, `deletedAt IS NULL`，`language` fallback
- 實作 per-queryType TTL 快取（60s），減少重複 DB 查詢
- 簽名：`hasContentFor(queryType: QueryType, language: string): Promise<boolean>`

**`RetrievalPlanBuilder`**
- 過濾 noise/unknown token，依 weight 排序，輸出 `searchTerms`
- 返回 `RetrievalPlan { searchTerms, strategies, maxResults, language }`
- `language` 始終等於傳入值，**不允許空字串**

---

### 3.2 HybridRetrievalModule（新增）

**路徑**：`src/hybrid-retrieval/`

```
src/hybrid-retrieval/
  hybrid-retrieval.module.ts
  hybrid-retrieval.service.ts
  retrievers/
    keyword.retriever.ts
    vector.retriever.interface.ts
    vector.retriever.stub.ts
    graph.retriever.interface.ts
    graph.retriever.stub.ts
    graph.retriever.postgres.ts    ← optional V1
  fusion/
    retrieval-fusion.service.ts
    reranker.service.ts
  gate/
    retrieval-decision.service.ts
  types/
    retrieval-decision.type.ts
    chunk-result.type.ts
```

#### 服務職責

**`HybridRetrievalService`**
- 並行呼叫 `KeywordRetriever`、`VectorRetriever`（stub → `[]`）、`GraphRetriever`（stub 或 Postgres join）
- 結果傳入 `RetrievalFusionService.fuse()` → `RerankerService.rerank()`
- V1 實際行為等同 `KeywordRetriever`（vector/graph 均回傳 `[]`）

**`KeywordRetriever`**
- 注入 `RETRIEVAL_SERVICE`（`PostgresRetrievalService`）
- 接受 `RetrievalPlan`，只做 pg_trgm / ILIKE 查詢
- **嚴格禁止**在此服務中加入任何分詞、停用詞、bigram、domain signal 邏輯
- 去重 by `knowledgeEntryId`，保留最高分

**`IVectorRetriever`（interface）** + **`VectorRetrieverStub`**
- DI token：`VECTOR_RETRIEVER`
- Stub 回傳 `Promise.resolve([])`
- pgvector embedding 生成不在 003 範圍

**`IGraphRetriever`（interface）** + **`GraphRetrieverStub`** / **`GraphRetrieverPostgres`**
- DI token：`GRAPH_RETRIEVER`
- Stub 回傳 `Promise.resolve([])`
- `GraphRetrieverPostgres`（optional）：單跳 Postgres join，透過 `KnowledgeRelation` 擴展實體

**`RetrievalFusionService`**
- Dedup by canonical key：`chunkId` 優先，否則 `` `entry:${knowledgeEntryId}` ``
- 相同 key 保留最高分

**`RerankerService`**
- BM25-style term frequency boost
- `termBonus`：每命中 `searchTerms` 中一詞加 0.03，上限 0.15

**`RetrievalDecisionService`**
- `decideFromChunks(chunks, understandingResult, minScore)` — Hybrid path
- `decideFromRetrievalResults(results, understandingResult, minScore)` — Legacy path
- `private evaluate()` — 共用評估邏輯：no results → low score → unsupported → all noise → ok
- 返回 `RetrievalDecision { canAnswer, reason, confidence, topK }`

---

### 3.3 ChatPipelineService Integration（修改）

只以 feature flags 為開關擴充，預設行為與 002 完全相同。

**Step 2.5（新增）**：QueryUnderstanding V2 path
- `feature.query_understanding_v2_enabled=true`：呼叫 `QueryUnderstandingService.understand()`，填入 `ctx.queryUnderstandingResult`
- 同時以 `adaptToAnalyzedQuery()` 維持 `ctx.analyzedQuery` 格式，確保下游相容
- 預設（false）：走 002 `QueryAnalysisService` fallback path，不變

**Step 6（修改）**：Hybrid / Legacy retrieval
- `feature.hybrid_retrieval_enabled=true` 且有 `ctx.queryUnderstandingResult`：
  - 呼叫 `HybridRetrievalService.retrieve(plan, limit)`
  - 呼叫 `decideFromChunks()` 填入 `ctx.retrievalDecision`
- 否則（legacy path）：
  - 呼叫 `PostgresRetrievalService.retrieve()`，填入 `ctx.ragResults`
  - `feature.no_answer_gate_enabled=true` 時，呼叫 `decideFromRetrievalResults()` 填入 `ctx.retrievalDecision`
- **`feature.hybrid_retrieval_enabled=false` 不讓 No-answer Gate 失效**

**Step 6.5（新增）**：No-answer Gate
- `feature.no_answer_gate_enabled=false`：直接跳過
- `ctx.retrievalDecision.canAnswer=false`：寫 fallback SSE，寫 AuditLog（`llmCalled=false`），中止管線
- `ctx.retrievalDecision.canAnswer=true`：繼續

**Step 9（不變）**：`AnswerTemplateResolver` 保留

**Step 10（條件收緊）**：LLM 只在 `canAnswer=true` 且 `answerMode=llm|hybrid_rag` 時呼叫

**Step 11（修改）**：填入 `GeneratedAnswer`（含 `sourceReferences`），AuditLog V2 欄位

---

## 4. Data Model Plan

### Additive Prisma Migration

一次性加法性 migration，不修改任何現有 table：

```
prisma/migrations/
  20260429000001_add_phase3_knowledge_graph/
    migration.sql
```

**`migration.sql` 只包含**：  
`CREATE TABLE knowledge_documents ...`  
`CREATE TABLE knowledge_chunks ...`  
`CREATE TABLE knowledge_entities ...`  
`CREATE TABLE knowledge_relations ...`

**嚴格禁止**：`ALTER TABLE knowledge_entries ...`、`DROP TABLE ...`、任何對現有 table 的破壞性操作。

### 新增 Model 說明

**`KnowledgeDocument`**
- 知識內容的頂層分組單位
- 必要欄位：`id`（cuid）、`sourceKey`（unique）、`title`、`docType`（enum）、`language`、`status`
- 003 補齊欄位：`visibility String @default("private")`、`metadata Json?`、`deletedAt DateTime?`
- `KnowledgeAvailabilityChecker` 篩選條件依賴 `visibility='public'` 與 `deletedAt IS NULL`

**`KnowledgeChunk`**
- 可檢索的知識單元，對應 `VectorRetriever`（004+）及 `KeywordRetriever`（V1 backfill）
- 必要欄位：`id`（cuid）、`documentId`（FK）、`content`、`chunkIndex`、`tokenCount`、`language`
- 003 補齊欄位：`metadata Json?`、`embeddingId String?`（nullable，004+ vector search 用）
- 無獨立 `visibility` 欄位；**visibility 繼承自父 `KnowledgeDocument`**
- `KnowledgeAvailabilityChecker` 透過 join document 來套用 `visibility / deletedAt` 條件

**`KnowledgeEntity`**
- 從知識中提取的命名實體
- 欄位：`id`、`name`、`entityType`（enum）、`canonicalKey`（unique）

**`KnowledgeRelation`**
- 實體間具型關聯，供 `GraphRetriever` 單跳擴展使用
- 欄位：`id`、`fromEntityId`、`toEntityId`、`relationType`（enum）

### 現有 Schema 策略

| 現有資料 | 策略 |
|---------|------|
| `knowledge_entries` | 完全保留；003 繼續使用 |
| `KnowledgeEntry.id`（number） | `ChunkResult.knowledgeEntryId`（legacy path）|
| `KnowledgeEntry.sourceKey` | 繼續作為 retrieval key |

### KnowledgeEntry Backfill（Optional）

- 提供 `prisma/seeds/backfill-knowledge-documents.seed.ts`（optional script）
- 遍歷所有 `KnowledgeEntry`，依 `sourceKey` 建立對應 `KnowledgeDocument` + `KnowledgeChunk`
- `KnowledgeChunk.sourceReference = 'KnowledgeEntry:${entry.id}'`
- 不強制執行；003 主要功能不依賴此 backfill
- 執行前後 `knowledge_entries` 資料不變

---

## 5. Integration Plan

### 完整請求流程

```
UserMessage (zh-TW / en)
        │
        ▼
Step 2.5  QueryUnderstandingService V2
        │  feature.query_understanding_v2_enabled=true
        │  → TokenizerProvider → JiebaTokenizer / EnglishTokenizer / RuleBasedTokenizer
        │  → QueryTypeClassifier
        │  → SupportabilityClassifier (+ KnowledgeAvailabilityChecker)
        │  → RetrievalPlanBuilder
        │  → QueryUnderstandingResult（含 retrievalPlan）
        │
        │  feature.query_understanding_v2_enabled=false
        └→ 002 QueryAnalysisService（不變）
        │
        ▼
Steps 3–5  Safety / Intent（不變）
        │
        ▼
Step 6    Retrieval
        │  feature.hybrid_retrieval_enabled=true
        │  → HybridRetrievalService（KeywordRetriever + stubs）
        │  → ChunkResult[]
        │  → decideFromChunks() → ctx.retrievalDecision
        │
        │  feature.hybrid_retrieval_enabled=false（legacy）
        │  → PostgresRetrievalService（不變）
        │  → RetrievalResult[]
        │  feature.no_answer_gate_enabled=true →
        └→ decideFromRetrievalResults() → ctx.retrievalDecision
        │
        ▼
Step 6.5  No-answer Gate
        │  feature.no_answer_gate_enabled=false → skip
        │  canAnswer=false → fallback SSE + AuditLog（llmCalled=false） → END
        └  canAnswer=true → continue
        │
        ▼
Steps 7–8  evaluateConfidence / buildPrompt（不變）
        │
        ▼
Step 9    AnswerTemplateResolver（不變）
        │  answerMode=template / rag+template → SSE done（llmCalled=false）→ END
        └  answerMode=hybrid_rag / llm → continue
        │
        ▼
Step 10   callLlmStream（只在 canAnswer=true 且 answerMode 需要 LLM 時執行）
        │
        ▼
Step 11   GeneratedAnswer + AuditLog V2
          sourceReferences（始終存在）
          answerMode（5 種）
          trace（feature.traceable_answer_enabled=true 時填入）
```

### 關鍵路徑邏輯

**Feature flags 全 false（002 baseline）**
- Step 2.5 走 002 `QueryAnalysisService`（不變）
- Step 6 走 `PostgresRetrievalService`（不變）
- Step 6.5 跳過
- 行為與 002 完全相同

**`no_answer_gate_enabled=true`，`hybrid_retrieval_enabled=false`（Phase C）**
- Step 6 仍走 legacy `PostgresRetrievalService`
- 但在 Step 6 末尾，`decideFromRetrievalResults()` 將 `RetrievalResult[]` 轉換並填入 `ctx.retrievalDecision`
- Step 6.5 照常執行 Gate 檢查
- **legacy path 不讓 Gate 失效**

**`answerMode` 與 Gate 的關係**

| `canAnswer` | `answerMode` | `llmCalled` | 說明 |
|------------|-------------|------------|------|
| `false` | `fallback` | false | Gate 阻擋，一律不呼叫 LLM |
| `true` | `llm` / `hybrid_rag` | true | Gate 通過，LLM 呼叫 |
| `true` | `rag+template` / `template` | false | Gate 通過，但模式不需要 LLM |

- `template` / `rag+template` 不呼叫 LLM，不受 No-answer Gate 阻擋（但也不產生脫離知識庫的答案）
- `canAnswer=false` 時，**禁止**呼叫 LLM（即使原先 answerMode 為 `llm` 或 `hybrid_rag`）

---

## 6. Testing Plan

### 6.1 Unit Tests

#### Tokenizer 測試

**`jieba.tokenizer.spec.ts`**
- zh-TW 產品詞（螺絲、螺栓、螺帽）正確分類為 `Product`
- 規格識別碼（304、316、M3、M4、ISO 4762）保留為 `Spec`
- 問句殼層詞彙（你們、請問、可以、麻煩）分類為 `Noise`
- 「上班時間 / 營業時間 / 公司地址」分類為 `Business`（**非** `Noise`）
- Jieba 初始化失敗時 `isReady()=false`，不拋例外
- `token.source` 正確標記（`'jieba'` / `'dictionary'` / `'glossary'`）

**`english.tokenizer.spec.ts`**
- 停用詞移除（what、how、can、please、the 等）
- Product / Spec / Contact / Business 分類正確
- `'hours'`、`'address'`、`'location'` 分類為 `Business`（**非** `Noise`）
- `'screw'`、`'bolt'`、`'nut'` 分類為 `Product`
- `'contact'`、`'email'`、`'phone'` 分類為 `Contact`
- `'quote'`、`'catalog'` 分類為 `Business`
- `token.source='english'`

**`rule-based.tokenizer.spec.ts`**
- fallback 輸出不為空
- 不拋例外
- `token.source='rule-based'`

#### TokenizerProvider 測試

**`tokenizer-provider.service.spec.ts`**
- `language='en'` 回傳 `EnglishTokenizer`
- `feature.zh_tokenizer='jieba'` 且 Jieba ready → 回傳 `JiebaTokenizer`
- `feature.zh_tokenizer='jieba'` 且 Jieba **not** ready → 靜默 fallback 至 `RuleBasedTokenizer`，輸出 WARN，不拋例外
- `feature.zh_tokenizer='rule-based'` → 回傳 `RuleBasedTokenizer`

#### Classifier 測試

**`query-type.classifier.spec.ts`**
- `「我想知道你們上班時間」` → `QueryType.BusinessHours`（**非** `Unsupported` 或 `QuoteRequest`）
- `「公司地址在哪」` → `QueryType.BusinessHours` 或 `Contact`（依 token 組合）
- `「請問螺絲報價」` → `QueryType.QuoteRequest`（product + business token 混合）
- `「可以 麻煩 請問 一下」`（全 noise tokens）→ `QueryType.Unsupported`
- `isBusinessHoursQuery` 判斷在 `hasBusiness` 之前執行（pattern 優先原則）
- 明確 pattern 優先於 `onlyNoise` 判斷

**`supportability.classifier.spec.ts`**
- `allNoise=true` → `unsupported`，`unsupportedReason='all_tokens_noise'`
- `queryType=Unsupported` → `unsupported`，`unsupportedReason='classifier_unsupported'`
- `KnowledgeAvailabilityChecker.hasContentFor()` 回傳 false → `unsupported`，reason 含 queryType
- `hasContentFor()` 回傳 true → `supported`
- `language` 正確傳遞至 `hasContentFor(queryType, language)`

**`knowledge-availability-checker.spec.ts`**
- `business_hours` queryType，KB 有對應內容 → `true`（supported）
- `business_hours` queryType，KB **無**對應內容 → `false`（unsupported + `no_kb_content_for_business_hours`）
- 快取命中時不重複查詢 DB
- `status='draft'` 或 `visibility='private'` 的條目不影響 `hasContentFor` 結果
- `deletedAt` 非 null 的條目不影響 `hasContentFor` 結果

#### QueryUnderstandingService 測試

**`query-understanding.service.spec.ts`**
- JiebaTokenizer 可用時使用 Jieba
- JiebaTokenizer 不可用時 fallback 至 `RuleBasedTokenizer`，`QueryUnderstandingResult.tokenizer='rule-based'`
- 英文查詢使用 `EnglishTokenizer`
- `retrievalPlan.searchTerms` 不含 `Noise` / `Unknown` token
- all-noise 查詢：`supportability='unsupported'`
- `retrievalPlan.language` 始終等於傳入的 `language`，不為空字串
- `keyPhrases` 只含 `weight >= 0.7` 且非 `Noise` 的 token

#### `RetrievalPlanBuilder` 測試

**`retrieval-plan.builder.spec.ts`**
- `searchTerms` 不含 `Noise` / `Unknown` token
- 依 `weight` 由高到低排序
- `language` 欄位等於傳入值

#### Hybrid Retrieval 測試

**`keyword.retriever.spec.ts`**
- 依 `plan.searchTerms` 依序呼叫 `PostgresRetrievalService`
- 去重 by `knowledgeEntryId`，保留最高分
- **不得**包含任何分詞 / 停用詞 / bigram 邏輯（靜態 code review 驗收）

**`vector.retriever.stub.spec.ts`**
- 永遠回傳 `[]`

**`graph.retriever.stub.spec.ts`**
- 永遠回傳 `[]`

**`retrieval-fusion.service.spec.ts`**
- 相同 `chunkId` → 保留最高分，去重
- 相同 `knowledgeEntryId` → 保留最高分，去重（canonical key `entry:${id}`）
- keyword / vector / graph 來源結果正確合併

**`reranker.service.spec.ts`**
- 命中 `searchTerms` 中詞語加 `termBonus`
- `termBonus` 上限 0.15
- 結果依 score 由高到低排序

#### No-answer Gate 測試

**`retrieval-decision.service.spec.ts`**

Hybrid path（`decideFromChunks`）：
- 空陣列 → `canAnswer=false`，`reason='no_results'`
- 最高分 < `minScore` → `canAnswer=false`，`reason='low_score'`
- `supportability='unsupported'` → `canAnswer=false`，`reason=unsupportedReason`
- all-noise tokens → `canAnswer=false`，`reason='all_tokens_noise'`
- 正常命中，`supportability='supported'` → `canAnswer=true`

Legacy path（`decideFromRetrievalResults`）：
- 空陣列 → `canAnswer=false`，`reason='no_results'`
- 最高分 < `minScore` → `canAnswer=false`，`reason='low_score'`
- 正常命中 → `canAnswer=true`

`understandingResult=undefined`（QU V2 未啟用）：
- 只依賴 score 判斷，Gate 不因 QU V2 關閉而失效

---

### 6.2 ChatPipeline Integration Tests

**`chat-pipeline.service.spec.ts`（擴充現有）**

| 測試情境 | 預期結果 |
|---------|---------|
| feature flags 全 false | 行為與 002 完全相同，現有 baseline 不受影響 |
| `quV2Enabled=true` | 使用 `QueryUnderstandingService V2`，`ctx.queryUnderstandingResult` 填入 |
| `hybridEnabled=false, gateEnabled=true` | Legacy `RetrievalResult[]` 正確轉換，`ctx.retrievalDecision` 填入 |
| `hybridEnabled=false, gateEnabled=true`，legacy 無命中 | `canAnswer=false` → fallback SSE，`llmCalled=false` |
| `hybridEnabled=false, gateEnabled=true`，legacy 低分 | `canAnswer=false` → fallback SSE，`llmCalled=false` |
| `hybridEnabled=true, gateEnabled=true`，`canAnswer=false` | fallback SSE，`llmCalled=false`，LLM 未呼叫 |
| `gateEnabled=true`，`canAnswer=true`，`answerMode=template` | `llmCalled=false` |
| `gateEnabled=true`，`canAnswer=true`，`answerMode=llm` | `llmCalled=true` |
| `gateEnabled=true`，`canAnswer=false`，`answerMode=llm`（原本計畫） | Gate 阻擋，最終 `answerMode=fallback`，`llmCalled=false` |
| SSE done payload | 向下相容；新欄位 `sourceReferences` / `trace` 為 optional，不影響未升級客戶端 |
| `sourceReferences` 存在性 | 所有 `answerMode` 均包含 `sourceReferences`；`fallback` 時為空陣列 `[]` |

---

### 6.3 Regression Tests

沿用 002 regression suite 結構（`src/regression/`）：

| Regression Suite | 要求 |
|-----------------|------|
| zh-TW 20 條 FAQ fixtures | 啟用 QU V2 後，`expectedAction` 仍符合（SC-002） |
| en 10 條 FAQ fixtures | 啟用 QU V2 後，分數仍 ≥ `rag_minimum_score`（SC-003） |
| Jieba fallback fixtures | 模擬 Jieba 初始化失敗，零個 500 錯誤（SC-004） |
| English tokenizer regression | `feature.zh_tokenizer=jieba` 啟用後，英文查詢結果不退化 |
| No-answer Gate regression | `canAnswer=false` 時，所有情境均 `llmCalled=false`（SC-001） |
| Traceable answer regression | `feature.traceable_answer_enabled=true` 時，AuditLog 含 `sourceReferences`（SC-006） |
| `business_hours` fixtures（KB 無內容）| `canAnswer=false`，`llmCalled=false` |
| `business_hours` fixtures（KB 有內容）| `canAnswer=true`，正常回答 |
| Baseline（flags 全 false）| 003 合併後，現有 baseline 全數通過（SC-007） |

---

## 7. Rollout Plan

### Phase A：Schema + Flags + Scaffolding

**目標**：所有 003 程式碼上線，feature flags 全 false，系統行為與 002 完全相同。

**影響範圍**
- 新增 Prisma migration（additive）
- 新增 `SystemConfig` feature flags seed
- Module scaffolding（空殼 / interface only）
- 不修改任何現有 module

**主要驗收**
- SC-007：baseline test suite 全數通過，不需修改
- `feature.query_understanding_v2_enabled=false` 下，所有 chat endpoint 行為不變
- Prisma migration 成功執行，無資料遺失

**Rollback**
- 刪除 migration（若尚未在 production 執行）
- 或保留空表格（不影響任何功能）

---

### Phase B：QueryUnderstanding V2（rule-based tokenizer）

**目標**：`feature.query_understanding_v2_enabled=true`，`feature.zh_tokenizer=rule-based`，QU V2 管線啟動但使用現有 `RuleBasedTokenizer`。

**影響範圍**
- `QueryUnderstandingModule` 全部完成（含 Classifiers、Builders）
- `ChatPipelineService` Step 2.5 擴充
- AuditLog 加入 `queryType` / `supportability` / `tokenizer` 欄位

**主要驗收**
- AuditLog 正確記錄 `queryType` 分布、`supportability` 分布
- zh-TW FAQ regression 通過（`expectedAction` 不退化）
- 「上班時間」類查詢正確判斷為 `QueryType.BusinessHours`
- `EnglishTokenizer` 正確分類英文 token

**Rollback**
```sql
UPDATE system_configs SET value = 'false'
WHERE key = 'feature.query_understanding_v2_enabled';
```

---

### Phase C：No-answer Gate（legacy retrieval path）

**目標**：`feature.no_answer_gate_enabled=true`，legacy `PostgresRetrievalService` 結果也能驅動 No-answer Gate。

**影響範圍**
- `RetrievalDecisionService` 完成（`decideFromChunks` + `decideFromRetrievalResults`）
- `ChatPipelineService` Step 6.5 加入
- AuditLog 加入 `canAnswer` / `fallbackReason` / `llmCalled` 欄位

**主要驗收**
- SC-001：領域外查詢 100% `llmCalled=false`
- Legacy path 無命中 → `canAnswer=false`，`llmCalled=false`
- `canAnswer=false` 比率可於 AuditLog 監控
- `canAnswer=true` 時，管線行為不變

**Rollback**
```sql
UPDATE system_configs SET value = 'false'
WHERE key = 'feature.no_answer_gate_enabled';
```

---

### Phase D：JiebaTokenizer

**目標**：`feature.zh_tokenizer=jieba`，切換 zh-TW 分詞至 Jieba。

**影響範圍**
- `JiebaTokenizer` 完成（含 domain dictionary、規格 token 保留）
- `TokenizerProvider` fallback 機制
- Dockerfile / CI 確認 `nodejieba`（或選定 package）可編譯

**主要驗收**
- SC-002：20 條 zh-TW FAQ fixtures 仍通過
- SC-004：Jieba 初始化失敗時，零個 500 錯誤
- 「上班時間」分類為 `Business`（非 `Noise`）
- 304 / 316 / M3 / M4 保留為 `Spec` token
- AuditLog `tokenizer='jieba'` 分布監控

**Rollback**
```sql
UPDATE system_configs SET value = 'rule-based'
WHERE key = 'feature.zh_tokenizer';
```

---

### Phase E：HybridRetrievalService V1

**目標**：`feature.hybrid_retrieval_enabled=true`，啟用 `HybridRetrievalService`（V1 以 `KeywordRetriever` 為主）。

**影響範圍**
- `HybridRetrievalService`、`KeywordRetriever`、stubs、`RetrievalFusionService`、`RerankerService`
- `ChatPipelineService` Step 6 hybrid path
- `ChunkResult[]` → `ctx.retrievalDecision` via `decideFromChunks()`

**主要驗收**
- SC-005：`KeywordRetriever` 不含語言理解邏輯
- V1 實際行為等同 legacy `KeywordRetriever`（vector / graph stubs 均回傳 `[]`）
- `dedup` 邏輯正確（相同 canonical key 保留最高分）
- Regression suite 通過

**Rollback**
```sql
UPDATE system_configs SET value = 'false'
WHERE key = 'feature.hybrid_retrieval_enabled';
```

---

### Phase F：Traceable Answer / AuditLog V2

**目標**：`feature.traceable_answer_enabled=true`，啟用完整 `trace` metadata 及 `sourceReferences` 填充。

**影響範圍**
- `GeneratedAnswer` 含 `trace`、`AnswerTrace`、`ChunkTraceDetail`
- AuditLog V2 `retrievalCandidates`、`trace` 欄位
- `buildSourceReferences()` 完整實作

**主要驗收**
- SC-006：LLM 生成答案的 AuditLog 包含非空 `sourceReferences`
- `sourceReferences` 在 `answerMode=fallback` 時為空陣列 `[]`，在其他模式時非空
- `trace` 欄位不影響 SSE event schema（向下相容）

**Rollback**
```sql
UPDATE system_configs SET value = 'false'
WHERE key = 'feature.traceable_answer_enabled';
```

---

### GA：Regression 驗收 + Cleanup 評估

**目標**：所有 Phase A–F 完成後，以完整 regression suite 驗證，準備設定 `feature.query_understanding_v2_enabled` 為 production default。

**主要驗收**
- SC-001 to SC-007 全數通過
- `canAnswer=false` 比率、`tokenizer` 分布、`answerMode` 分布監控穩定
- P95 `queryUnderstandingMs` < 50ms（含 `KnowledgeAvailabilityChecker` 快取熱啟後）
- SSE done payload 向下相容驗證通過

**Cleanup（GA 後可評估，非 GA blocking）**
- 移除舊 `QueryAnalysisService` feature flag 分支（002 fallback path）
- 統一 `ChunkResult` / `RetrievalResult` 型別（若 `KnowledgeEntry` 已被 `KnowledgeChunk` 取代）

---

## 8. Migration and Rollback Plan

### Additive Prisma Migration

```bash
npx prisma migrate dev --name add_phase3_knowledge_graph
```

- 只建立新表格，不修改現有 table
- Migration 可安全 rollback（drop new tables only）

### SystemConfig Feature Flags Seed

```typescript
// prisma/seeds/003-feature-flags.seed.ts
// 使用 upsert，不覆蓋已有設定
const flags = [
  { key: 'feature.query_understanding_v2_enabled', value: 'false' },
  { key: 'feature.zh_tokenizer', value: 'rule-based' },
  { key: 'feature.hybrid_retrieval_enabled', value: 'false' },
  { key: 'feature.no_answer_gate_enabled', value: 'false' },
  { key: 'feature.traceable_answer_enabled', value: 'false' },
];
```

### Optional KnowledgeEntry Backfill

```bash
npx ts-node prisma/seeds/backfill-knowledge-documents.seed.ts
```

- 可選，不影響主要功能
- 執行前後 `knowledge_entries` 資料不變
- `KnowledgeChunk.sourceReference = 'KnowledgeEntry:${entry.id}'`

### Jieba Failure Fallback

1. `TokenizerProvider` 偵測 `jiebaTokenizer.isReady()=false`，靜默 fallback，輸出 WARN
2. 可透過 `feature.zh_tokenizer=rule-based` 明確停用 Jieba，不需重新部署
3. AuditLog `tokenizer` 欄位記錄實際使用的分詞器

### Feature Flag Rollback

所有 feature flags 均可透過直接 DB 更新回滾，立即生效，不需重新部署：

```sql
-- 完整回滾至 002 baseline
UPDATE system_configs SET value = 'false'
WHERE key IN (
  'feature.query_understanding_v2_enabled',
  'feature.hybrid_retrieval_enabled',
  'feature.no_answer_gate_enabled',
  'feature.traceable_answer_enabled'
);

-- Jieba 回滾
UPDATE system_configs SET value = 'rule-based'
WHERE key = 'feature.zh_tokenizer';
```

---

## 9. Risks and Mitigations

| 風險 | 嚴重度 | 緩解措施 |
|------|--------|---------|
| `nodejieba` native addon 在 CI / Docker 無法編譯 | 高 | Dockerfile 安裝 `python3 make g++`；CI 加入編譯驗證 step；`TokenizerProvider` 強制靜默 fallback；Phase D 前先完整驗證 |
| Domain dictionary 不完整，Jieba 分詞準確率不足 | 中 | Phase B 先以 `rule-based` 觀察 AuditLog token 分布，Phase D 才切 Jieba；逐步補充 `config/jieba-domain.txt` |
| `SupportabilityClassifier` 過嚴（false negative rate 過高），正確查詢被誤判為 unsupported | 中 | Phase C 開啟後監控 `canAnswer=false` 比率，以 AuditLog `unsupportedReason` 識別誤判類型；可調整 `KnowledgeAvailabilityChecker` queryType → category mapping |
| `SupportabilityClassifier` 過鬆（false positive），仍允許低品質查詢進入 LLM | 低 | `rag_minimum_score` 作為第二層防線；Phase C 觀察期內調整閾值 |
| `KnowledgeAvailabilityChecker` 查詢延遲影響 P95 | 中 | per-queryType TTL 快取（60s）；`debugMeta` 記錄 `queryUnderstandingMs`；若 P95 > 50ms 則強制開啟快取 |
| Hybrid Retrieval scope creep，被要求在 003 做完整 GraphRAG | 中 | 文件明確說明 V1 Vector / Graph 均為 stub；`VectorRetrieverStub` / `GraphRetrieverStub` 始終回傳 `[]`；完整 GraphRAG 為 004+ |
| `VectorRetrieverStub` / `GraphRetrieverStub` 被誤認為已實作完整 vector / graph search | 低 | 在 AuditLog `retrievalCandidates.retriever` 欄位記錄 retriever 來源；stub 回傳 `[]` 在測試中可觀察 |
| `sourceReferences` / `trace` 新欄位破壞 SSE payload 相容性 | 低 | `sourceReferences` / `trace` 為加法性新增 optional 欄位；不修改現有 `SseDonePayload` 必填欄位；整合測試驗證向下相容 |
| 導入 Jieba 導致英文查詢退化 | 低 | `TokenizerProvider` 在 `language='en'` 時直接回傳 `EnglishTokenizer`，與 `feature.zh_tokenizer` 設定無關；英文 tokenizer regression suite 獨立驗收（SC-003） |
| KnowledgeEntry backfill 與 `KnowledgeDocument` 資料不一致 | 低 | backfill 為 optional；003 主要功能路徑不依賴 backfill；`KnowledgeChunk.sourceReference` 保留 backfill 來源記錄 |

---

## 10. Open Questions

| # | 問題 | 影響 | 建議決策點 |
|---|------|------|-----------|
| OQ-1 | **Jieba package 選型**：`nodejieba` 或 `@node-rs/jieba`？需考慮 native addon 編譯複雜度、TypeScript binding 品質、社群活躍度。 | Phase D 前需確認 | Phase A 期間在 Dockerfile / CI 環境驗證，再決定 |
| OQ-2 | **Domain dictionary V1**：使用靜態 `config/jieba-domain.txt`，還是在 module init 時從 `GlossaryTerm` + `KnowledgeEntry.tags` 動態匯出？ | Phase D Jieba 準確率 | V1 建議靜態檔（降低複雜度），Phase D 後依 AuditLog 結果評估是否動態同步 |
| OQ-3 | **`GraphRetriever` V1 實作**：stub（永遠回傳 `[]`）或 simple Postgres join（single-hop `KnowledgeRelation` 展開）？ | Phase E 交付範圍 | 建議 V1 使用 stub；有真實 `KnowledgeEntity` / `KnowledgeRelation` 資料後再切換 |
| OQ-4 | **KnowledgeEntry backfill 時機**：003 第一批執行，還是在 Phase E（Hybrid 啟用）後再執行？ | `KeywordRetriever` V1 資料豐富度 | Phase E 前評估；`KnowledgeEntry` 資料仍可透過 legacy path 提供，無需急於 backfill |
| OQ-5 | **Internal / admin retrieval test endpoint**：是否需要 `GET /admin/retrieval/test?q=...` 供 QA 手動驗證 retrieval 結果？ | QA 效率 | 可列為 optional task；不影響主功能 |
| OQ-6 | **`rag_minimum_score` 與 `rag_answer_threshold` 調整**：啟用 No-answer Gate 後，現有閾值（`rag_minimum_score=0.25`）是否需要調整？ | Gate 觸發率 | Phase C 後觀察 1 週 AuditLog，再決定是否調整 |
| OQ-7 | **`business_hours` fallback 文案**：KB 無 `business_hours` / `company_info` 內容時，fallback 訊息是否沿用現有 fallback template，或另外定製？ | UX | 建議沿用現有 fallback template（不增加 003 複雜度），待 004 再個別處理 |

---

## 11. Acceptance Examples

以下為 Spec 中定義的核心驗收情境，實作完成後需逐一驗證。

---

### Example 1 — zh-TW 產品類別查詢

**輸入**：`你們有哪些螺絲類別`

| 驗收項目 | 預期值 |
|---------|--------|
| `JiebaTokenizer` 分詞結果 | 包含 `螺絲`（`Product`）/ `螺絲類別`（`Product`）等高權重 token |
| `queryType` | `product_lookup` |
| `supportability` | `supported`（KB 有螺絲相關 `product_spec` / `faq` 條目） |
| `canAnswer` | `true` |
| `sourceReferences` | 非空陣列，至少包含一個 `sourceKey` |
| `llmCalled` | 依 `answerMode` 而定（`llm` / `hybrid_rag` → true；`template` → false） |

---

### Example 2 — 規格比較查詢

**輸入**：`我想知道不鏽鋼螺絲 304 跟 316 差在哪`

| 驗收項目 | 預期值 |
|---------|--------|
| `tokens` | 包含 `不鏽鋼`（`Material`）、`螺絲`（`Product`）、`304`（`Spec`）、`316`（`Spec`） |
| `queryType` | `product_comparison` |
| `supportability` | `supported`（KB 有 `product_spec` 條目） |
| `canAnswer` | `true`（若 KB 有對應內容）|
| `retrievalPlan.searchTerms` | 包含 `螺絲`、`304`、`316`、`不鏽鋼`；不含 noise token |

---

### Example 3 — 報價查詢（留資 / 聯絡業務路徑）

**輸入**：`想詢問不鏽鋼螺絲的報價`

| 驗收項目 | 預期值 |
|---------|--------|
| `queryType` | `quote_request` |
| `answerMode` | `template`（若有報價 template）或 `rag+template`（若 KB 有報價引導條目） |
| LLM 行為 | 不得臆測具體價格；應走留資 / 聯絡業務 / template or handoff path |
| `llmCalled` | 走 `template` 路徑時 `false` |

---

### Example 4 — 上班時間查詢（KB 無 / 有內容兩種情境）

**輸入**：`我想知道你們上班時間`

| 驗收項目 | 預期值（KB **無**內容） | 預期值（KB **有**內容）|
|---------|--------|--------|
| `tokenType`（上班時間）| `Business`（**非** `Noise`） | `Business`（**非** `Noise`） |
| `queryType` | `business_hours` | `business_hours` |
| `canAnswer` | `false` | `true` |
| `llmCalled` | `false` | 依 `answerMode` |
| `fallbackReason` | `no_kb_content_for_business_hours` | — |

---

### Example 5 — 英文聯絡 / 報價查詢

**輸入**：`How can I contact your company for a quote?`

| 驗收項目 | 預期值 |
|---------|--------|
| 使用的 tokenizer | `EnglishTokenizer`（`feature.zh_tokenizer` 設定不影響）|
| `tokens` | 包含 `contact`（`Contact`）、`quote`（`Business`）；stop words（how、can、your）移除 |
| `queryType` | `contact` 或 `quote_request`（依 token 優先順序） |
| 英文 retrieval | 不退化；`rag_minimum_score` 基準維持（SC-003） |

---

### Example 6 — 英文產品類別查詢

**輸入**：`What screw categories do you offer?`

| 驗收項目 | 預期值 |
|---------|--------|
| `tokens` | 包含 `screw`（`Product`）、`categories`（`Unknown` 或視 dictionary 而定）；stop words（what、do、you）移除 |
| `queryType` | `product_lookup` |
| `canAnswer` | `true`（若英文 KB 有對應內容）|
| `sourceReferences` | 非空陣列 |
