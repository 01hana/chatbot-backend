# Tasks: 003 — 混合式檢索與無答案閘門

**Input**: `specs/003-hybrid-retrieval-no-answer-gate/`（spec.md、design.md、plan.md）  
**Branch**: `003-hybrid-retrieval-no-answer-gate`  
**Prerequisites**: 001 SSE pipeline、002 QueryAnalysisModule（`src/query-analysis/`）、002 AnswerTemplateResolver、002 DiagnosisService

---

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: 可與同 Phase 其他任務並行（不同檔案、無依賴）
- **[Story]**: 對應 spec.md 使用者故事（US1–US5）
- **[US1]**: zh-TW 產品查詢正確命中知識條目（P1）
- **[US2]**: 不支援問句不呼叫 OpenAI（P1）
- **[US3]**: 英文查詢回傳有依據的答案（P2）
- **[US4]**: 生成的答案包含可回溯的來源引用（P2）
- **[US5]**: Jieba 初始化失敗不崩潰管線（P3）

---

## ⚠️ 重要限制（實作前必讀）

- **002 fallback path 不得觸動**：`src/query-analysis/` 目錄、`QueryAnalysisModule`、`QueryAnalysisService` 均不得搬移、改名或覆蓋
- **003 QU V2 獨立路徑**：新增模組放在 `src/query-understanding/`（與 `src/query-analysis/` 並存）
- **Retrieval 層禁止** 加入任何分詞、弱詞、bigram、domain signal 或 supportability 邏輯
- **feature flags 預設全 false**：所有 003 功能均以 `SystemConfig` 控制
- **Additive schema only**：不執行任何 `ALTER TABLE knowledge_entries` 或 `DROP TABLE`
- **不做完整 GraphRAG**：VectorRetriever / GraphRetriever V1 均為 stub（回傳 `[]`）

---

## Phase 0: Schema + Flags + Scaffolding

**目標**：003 所有程式碼上線，feature flags 全 false，系統行為與 002 完全相同

**驗收基準（SC-007）**：所有 Phase 0 任務完成後，`npm test` 現有 baseline test suite 全數通過，不需修改任何現有測試

### Prisma Schema（加法性）

- [ ] T001 在 `prisma/schema.prisma` 新增 `KnowledgeDocument` model（含 `visibility String @default("private")`、`metadata Json?`、`deletedAt DateTime?`），不修改既有 `KnowledgeEntry`
- [ ] T002 在 `prisma/schema.prisma` 新增 `KnowledgeChunk` model（含 `metadata Json?`、`embeddingId String?`），`visibility` 繼承自父 `KnowledgeDocument`（無獨立欄位）
- [ ] T003 [P] 在 `prisma/schema.prisma` 新增 `KnowledgeEntity` model 與 `KnowledgeEntityType` enum
- [ ] T004 [P] 在 `prisma/schema.prisma` 新增 `KnowledgeRelation` model 與 `KnowledgeRelationType` enum
- [ ] T005 執行 `npx prisma migrate dev --name add_phase3_knowledge_graph`，確認 migration SQL 只含 `CREATE TABLE`，不含任何 `ALTER TABLE knowledge_entries` 或 `DROP`

### Feature Flags Seed

- [ ] T006 建立 `prisma/seeds/003-feature-flags.seed.ts`，以 upsert 方式插入 5 個 feature flags，預設值全為 `false`（`feature.query_understanding_v2_enabled`、`feature.zh_tokenizer=rule-based`、`feature.hybrid_retrieval_enabled`、`feature.no_answer_gate_enabled`、`feature.traceable_answer_enabled`）

### Module Scaffolding

- [ ] T007 [P] 建立 `src/query-understanding/query-understanding.module.ts` 空殼（`@Module({})`，僅宣告，尚未 wire 任何 provider）
- [ ] T008 [P] 建立 `src/hybrid-retrieval/hybrid-retrieval.module.ts` 空殼
- [ ] T009 [P] 建立 `src/query-understanding/types/` 目錄結構，新增空的 barrel export `index.ts`
- [ ] T010 [P] 建立 `src/hybrid-retrieval/types/` 目錄結構，新增空的 barrel export `index.ts`

### Baseline Verification

- [ ] T011 確認所有 feature flags 為 `false` 時，`npm test` 現有 baseline test suite 全數通過（SC-007）；若有失敗，修復至通過後才繼續 Phase 1

---

## Phase 1: Query Understanding V2 — Core Types & Services

**目標**：`QueryUnderstandingModule` 核心介面、型別、Classifier、Builder 全部完成；`RuleBasedTokenizer` 包裝可用；可在 unit test 中完整執行 `QueryUnderstandingService.understand()`

**獨立測試**：`npx jest src/query-understanding` 全數通過；`QueryUnderstandingService.understand('你們有哪些螺絲類別', 'zh-TW')` 回傳 `queryType=product_lookup`、`supportability` 有值、`retrievalPlan.searchTerms` 非空

### 核心型別（可並行）

- [ ] T012 [P] [US1] 建立 `src/query-understanding/types/token-type.enum.ts`（`TokenType`：Product / Spec / Material / Dimension / Action / Business / Contact / Noise / Unknown）
- [ ] T013 [P] [US1] 建立 `src/query-understanding/types/query-type.enum.ts`（`QueryType`：ProductLookup / ProductComparison / QuoteRequest / Contact / CatalogDownload / BusinessHours / GeneralFaq / Unsupported / Unknown）
- [ ] T014 [P] [US1] 建立 `src/query-understanding/types/query-token.type.ts`（`QueryToken`：`text`、`normalizedText`、`tokenType`、`weight`、`source`：6 種）
- [ ] T015 [P] [US1] 建立 `src/query-understanding/types/retrieval-plan.type.ts`（`RetrievalPlan`：`searchTerms`、`strategies`、`maxResults`、`language`）
- [ ] T016 [P] [US1] 建立 `src/query-understanding/types/query-understanding-result.type.ts`（`QueryUnderstandingResult` 完整欄位：含 `tokenizer`、`tokens`、`keyPhrases`、`queryType`、`supportability`、`retrievalPlan`、`debugMeta`）
- [ ] T017 [P] [US1] 建立 `src/query-understanding/tokenizers/tokenizer.interface.ts`（`ITokenizer`：`tokenize(text, language): Promise<QueryToken[]>`）

### 工具與 Normalizer

- [ ] T018 [P] [US1] 建立 `src/query-understanding/utils/query-normalizer.ts`（`QueryNormalizer.normalize(rawQuery, language)`：全形轉半形、trim、多空格合一）

### Classifiers

- [ ] T019 [US1] 實作 `src/query-understanding/classifiers/query-type.classifier.ts`（`QueryTypeClassifier.classify(tokens, normalizedQuery)`；判斷順序：1. hasContact 2. isBusinessHoursQuery **3. hasBusiness+isCatalogQuery** 4. hasBusiness 5. hasProduct+isComparisonQuery 6. hasProduct||hasMaterial 7. onlyNoise 8. Unknown）
- [ ] T020 [P] [US2] 實作 `src/query-understanding/classifiers/knowledge-availability-checker.ts`（`KnowledgeAvailabilityChecker.hasContentFor(queryType, language)`；**雙來源查詢**：①先查 `KnowledgeEntry`（`status='approved'`、`visibility='public'`、`deletedAt IS NULL`、`language` 完全匹配）②再查 `KnowledgeDocument`（`visibility='public'`、`deletedAt IS NULL`、`language` 完全匹配）下的 `KnowledgeChunk`；兩邊均套用 language 優先完全匹配，無結果時 fallback 至語言無關內容（不帶 language 條件重查）；任一來源有結果即回傳 `true`；per-queryType TTL 快取 60s）
- [ ] T021 [US2] 實作 `src/query-understanding/classifiers/supportability.classifier.ts`（`SupportabilityClassifier.classify(queryType, tokens, language)`；all-noise → unsupported；queryType=Unsupported → unsupported；呼叫 `KnowledgeAvailabilityChecker.hasContentFor(queryType, language)`）

### Builders

- [ ] T022 [US1] 實作 `src/query-understanding/builders/retrieval-plan.builder.ts`（`RetrievalPlanBuilder.build(tokens, queryType, supportability, language)`；過濾 Noise/Unknown token；依 weight 排序；`language` 等於傳入值，不允許空字串）

### RuleBasedTokenizer（Phase 1 可用的 fallback tokenizer）

- [ ] T023 [US5] 實作 `src/query-understanding/tokenizers/rule-based.tokenizer.ts`（包裝現有 002 `RuleBasedQueryAnalyzer` bi-gram / sliding window 邏輯；所有 token 輸出 `source: 'rule-based'`；不複製 002 邏輯，透過 import 引用）

### TokenizerProvider（Phase 1 暫時版）

- [ ] T024 [US5] 實作 `src/query-understanding/tokenizers/tokenizer-provider.service.ts`（Phase 1 版本：`language='en'` **暫時**回傳 `RuleBasedTokenizer`（Phase 2 T034 建立 `EnglishTokenizer` 後再切換）；其餘 language 亦回傳 `RuleBasedTokenizer`；Jieba 路徑留空，Phase 2 T034 補齊；Jieba 不可用時靜默 fallback，不拋例外；`getLastUsedName()` 回傳實際使用的 tokenizer 名稱）

### QueryUnderstandingService

- [ ] T025 [US1] 實作 `src/query-understanding/query-understanding.service.ts`（`understand(rawQuery, language)`；協調 normalize → tokenize → classifyQueryType → classifySupportability → buildRetrievalPlan；記錄 `debugMeta.durationMs`）
- [ ] T026 [US1] 更新 `src/query-understanding/query-understanding.module.ts`，wire T017–T025 所有 providers

### Phase 1 Unit Tests

- [ ] T027 [P] [US1] 建立 `src/query-understanding/classifiers/query-type.classifier.spec.ts`（測試：「上班時間」→ BusinessHours 非 QuoteRequest；全 noise → Unsupported；isBusinessHoursQuery 在 hasBusiness 之前執行）
- [ ] T028 [P] [US2] 建立 `src/query-understanding/classifiers/supportability.classifier.spec.ts`（all-noise → unsupported；queryType=Unsupported → unsupported；KB 有內容 → supported；language 正確傳入 hasContentFor）
- [ ] T029 [P] [US2] 建立 `src/query-understanding/classifiers/knowledge-availability-checker.spec.ts`（KnowledgeEntry 有內容 → true；KnowledgeEntry 無內容 + KnowledgeDocument/KnowledgeChunk 有內容 → true；兩邊均無內容 → false；快取命中不重查 DB；status=draft/visibility=private/deletedAt 非 null 不計入；language 完全匹配優先，無匹配時 fallback 觸發；fallback 有結果亦回傳 true）
- [ ] T030 [P] [US1] 建立 `src/query-understanding/builders/retrieval-plan.builder.spec.ts`（searchTerms 不含 Noise/Unknown；依 weight 排序；language 等於傳入值）
- [ ] T031 [P] [US1] 建立 `src/query-understanding/query-understanding.service.spec.ts`（JiebaTokenizer 不可用時 fallback；`retrievalPlan.language` 不為空；`keyPhrases` 只含 weight≥0.7 非 Noise token；all-noise → supportability=unsupported）

**Phase 1 Checkpoint**：`npx jest src/query-understanding` 全數通過

---

## Phase 2: Tokenizer Implementation

**目標**：`JiebaTokenizer`（含 domain dictionary）、`EnglishTokenizer`、`RuleBasedTokenizer` 全部實作完成；`TokenizerProvider` fallback chain 正確；Jieba 初始化失敗不回 500

**獨立測試**：`npx jest src/query-understanding/tokenizers` 全數通過；模擬 Jieba init 失敗，`TokenizerProvider.getTokenizer('zh-TW')` 回傳 `RuleBasedTokenizer` 且無例外

### EnglishTokenizer

- [ ] T032 [P] [US3] 實作 `src/query-understanding/tokenizers/english.tokenizer.ts`（lowercasing；punctuation cleanup；STOP_WORDS 過濾；PRODUCT_TERMS → Product；BUSINESS_TERMS（含 hours/address/location）→ Business 非 Noise；CONTACT_TERMS → Contact；規格 pattern → Spec；所有 token `source='english'`）

### JiebaTokenizer

- [ ] T033 [US1] 實作 `src/query-understanding/tokenizers/jieba.tokenizer.ts`（實作 `ITokenizer` + `OnModuleInit`；動態 `import('nodejieba')`，失敗時 `_ready=false`，輸出 WARN，不拋例外；`classifyWord()`：上班時間/營業時間/公司地址 → Business **非 Noise**；304/316/M3/M4 保留為 Spec；domain dictionary `config/jieba-domain.txt` 載入；token.source 依來源標記 'jieba'/'dictionary'/'glossary'）
- [ ] T034 [US5] 更新 `src/query-understanding/tokenizers/tokenizer-provider.service.ts` 完整版（`language='en'` → EnglishTokenizer；`feature.zh_tokenizer='jieba'` 且 `isReady()=true` → JiebaTokenizer；`feature.zh_tokenizer='jieba'` 且 `isReady()=false` → 靜默 fallback RuleBasedTokenizer + WARN；`feature.zh_tokenizer='rule-based'` → RuleBasedTokenizer；`getLastUsedName()` 回傳實際使用的 tokenizer 名稱）

### Domain Dictionary & Infrastructure

- [ ] T035 [P] [US1] 建立 `config/jieba-domain.txt`（V1 靜態字典：螺絲、螺栓、螺帽、華司、不鏽鋼、碳鋼、鍍鋅等 domain 詞彙，Jieba 字典格式：`詞 頻率 詞性`）
- [ ] T036 [P] 更新 `Dockerfile`，確保 `python3`、`make`、`g++` 已安裝（nodejieba native addon 編譯需求）；若 CI 未涵蓋 native addon 編譯驗證，加入對應 CI step

### Phase 2 Unit Tests

- [ ] T037 [US1] 建立 `src/query-understanding/tokenizers/jieba.tokenizer.spec.ts`（螺絲/螺栓 → Product；304/316/M3/M4 → Spec；你們/請問/可以 → Noise；上班時間/營業時間/公司地址 → Business 非 Noise；init 失敗 isReady()=false 不拋例外；token.source 正確）
- [ ] T038 [P] [US3] 建立 `src/query-understanding/tokenizers/english.tokenizer.spec.ts`（stop words 移除；screw/bolt/nut → Product；hours/address/location → Business 非 Noise；contact/email/phone → Contact；quote/catalog → Business；token.source='english'）
- [ ] T039 [P] [US5] 建立 `src/query-understanding/tokenizers/rule-based.tokenizer.spec.ts`（fallback 輸出不為空；不拋例外；token.source='rule-based'）
- [ ] T040 [US5] 建立 `src/query-understanding/tokenizers/tokenizer-provider.service.spec.ts`（en → EnglishTokenizer；jieba ready → JiebaTokenizer；jieba not ready → RuleBasedTokenizer + WARN 無例外；rule-based → RuleBasedTokenizer）

**Phase 2 Checkpoint**：`npx jest src/query-understanding` 全數通過；SC-004 Jieba fallback scenario 不回 500

---

## Phase 3: Hybrid Retrieval V1

**目標**：`HybridRetrievalModule` 所有元件完成（KeywordRetriever、stubs、FusionService、RerankerService、HybridRetrievalService、RetrievalDecisionService）；V1 實際行為等同 KeywordRetriever；gate 邏輯可獨立 unit test

**獨立測試**：`npx jest src/hybrid-retrieval` 全數通過；`HybridRetrievalService.retrieve(plan, 5)` 回傳 `ChunkResult[]`；`RetrievalDecisionService.decideFromChunks([])` 回傳 `canAnswer=false, reason='no_results'`

### 核心型別

- [ ] T041 [P] [US1] 建立 `src/hybrid-retrieval/types/chunk-result.type.ts`（`ChunkResult`：`chunkId?`、`knowledgeEntryId?`、`sourceKey`、`content`、`score`、`language`、`isCrossLanguageFallback?`；兩者至少一個必填）
- [ ] T042 [P] [US2] 建立 `src/hybrid-retrieval/types/retrieval-decision.type.ts`（`RetrievalDecision`：`canAnswer`、`reason`、`confidence`、`topK: ChunkResult[]`）

### Retriever Interfaces & Stubs

- [ ] T043 [P] [US1] 建立 `src/hybrid-retrieval/retrievers/vector.retriever.interface.ts`（`IVectorRetriever`；DI token `VECTOR_RETRIEVER`）與 `src/hybrid-retrieval/retrievers/vector.retriever.stub.ts`（永遠回傳 `Promise.resolve([])`）
- [ ] T044 [P] [US1] 建立 `src/hybrid-retrieval/retrievers/graph.retriever.interface.ts`（`IGraphRetriever`；DI token `GRAPH_RETRIEVER`）與 `src/hybrid-retrieval/retrievers/graph.retriever.stub.ts`（永遠回傳 `Promise.resolve([])`）

### KeywordRetriever

- [ ] T045 [US1] 實作 `src/hybrid-retrieval/retrievers/keyword.retriever.ts`（注入 `RETRIEVAL_SERVICE`（`PostgresRetrievalService`）；依 `plan.searchTerms` 依序呼叫 retrieve；**嚴格禁止**加入任何分詞、停用詞、bigram、domain signal 邏輯；去重 by `knowledgeEntryId` 保留最高分；`toChunkResult()` 正確對映 `knowledgeEntryId: r.entry.id`、`sourceKey: r.entry.sourceKey ?? ''`）

### Fusion & Reranker

- [ ] T046 [US1] 實作 `src/hybrid-retrieval/fusion/retrieval-fusion.service.ts`（`fuse(keyword, vector, graph)`；canonical key = `r.chunkId ?? 'entry:${r.knowledgeEntryId}'`；相同 key 保留最高分）
- [ ] T047 [P] [US1] 實作 `src/hybrid-retrieval/fusion/reranker.service.ts`（BM25-style term bonus：每命中 searchTerm 加 0.03，上限 0.15；結果依 score 排序）

### HybridRetrievalService

- [ ] T048 [US1] 實作 `src/hybrid-retrieval/hybrid-retrieval.service.ts`（`retrieve(plan, limit)`；並行呼叫 KeywordRetriever / VectorRetriever stub / GraphRetriever stub；結果進 fuse → rerank → slice；V1 實際等同 KeywordRetriever）

### RetrievalDecisionService（No-answer Gate 邏輯）

- [ ] T049 [US2] 實作 `src/hybrid-retrieval/gate/retrieval-decision.service.ts`（`decideFromChunks(chunks, understandingResult, minScore)`；`decideFromRetrievalResults(results, understandingResult, minScore)`（內部 toChunkResult 轉換）；`private evaluate()`：no results → low score → unsupported → all noise → ok；`understandingResult=undefined` 時只依 score 判斷）

### Module Wiring

- [ ] T050 更新 `src/hybrid-retrieval/hybrid-retrieval.module.ts`，wire T041–T049 所有 providers（VectorRetriever 以 `VECTOR_RETRIEVER` DI token 提供 stub；GraphRetriever 同）

### Phase 3 Unit Tests

- [ ] T051 [P] [US1] 建立 `src/hybrid-retrieval/retrievers/keyword.retriever.spec.ts`（依序呼叫 retrieve；去重保留最高分；不含分詞邏輯的 code review 驗收說明）
- [ ] T052 [P] [US1] 建立 `src/hybrid-retrieval/fusion/retrieval-fusion.service.spec.ts`（相同 chunkId dedup；相同 knowledgeEntryId dedup；keyword/vector/graph 來源合併正確）
- [ ] T053 [P] [US1] 建立 `src/hybrid-retrieval/fusion/reranker.service.spec.ts`（termBonus 正確；上限 0.15；score 由高到低排序）
- [ ] T054 [P] [US1] 建立 `src/hybrid-retrieval/retrievers/vector.retriever.stub.spec.ts` 與 `src/hybrid-retrieval/retrievers/graph.retriever.stub.spec.ts`（永遠回傳 `[]`）
- [ ] T055 [US2] 建立 `src/hybrid-retrieval/gate/retrieval-decision.service.spec.ts`（hybrid path：空陣列 → no_results；低分 → low_score；unsupported → reason；all noise → all_tokens_noise；正常 → canAnswer=true；legacy path：空陣列 → false；低分 → false；正常 → true；understandingResult=undefined 只依 score）
- [ ] T056 [US1] 建立 `src/hybrid-retrieval/hybrid-retrieval.service.spec.ts`（KeywordRetriever 結果正確傳遞；stubs 回 [] 不影響；dedup 正確）

**Phase 3 Checkpoint**：`npx jest src/hybrid-retrieval` 全數通過

---

## Phase 4: No-answer Gate + ChatPipeline Integration

**目標**：`ChatPipelineService` 完整整合 Step 2.5 / Step 6 / Step 6.5 / Step 10；`feature.no_answer_gate_enabled=false` 時行為與 002 完全相同；`002 QueryAnalysisService` at `src/query-analysis/` **不修改**

**獨立測試**：`npx jest src/chat/chat-pipeline.service.spec.ts` 全數通過（含新增的 003 整合測試情境）；`feature.hybrid_retrieval_enabled=false, feature.no_answer_gate_enabled=true` + 零命中 → fallback SSE，`llmCalled=false`

### PipelineContext 擴充

- [ ] T057 [US1] 擴充 `PipelineContext` 型別（在 `src/chat/` 相關 types 檔案中），新增 `queryUnderstandingResult?: QueryUnderstandingResult` 與 `retrievalDecision?: RetrievalDecision`（加法性新增，不破壞現有欄位）

### ChatModule 更新

- [ ] T058 更新 `src/chat/chat.module.ts`，加入 `QueryUnderstandingModule` 與 `HybridRetrievalModule` imports；**保留既有** `QueryAnalysisModule`（from `src/query-analysis/`）import 不刪除

### Step 2.5 — QU V2 path

- [ ] T059 [US1] 在 `src/chat/chat-pipeline.service.ts` 實作 Step 2.5（`analyzeQuery` 擴充）：`feature.query_understanding_v2_enabled=true` → 呼叫 `QueryUnderstandingService.understand()`，填入 `ctx.queryUnderstandingResult`，並以 `adaptToAnalyzedQuery()` 維持 `ctx.analyzedQuery` 格式（確保下游 002 相容）；`false` → 走現有 `QueryAnalysisService`（`src/query-analysis/`）路徑，**不修改**

### Step 6 — Hybrid + Legacy + Gate Fill

- [ ] T060 [US1] 在 `src/chat/chat-pipeline.service.ts` 實作 Step 6 hybrid path：`feature.hybrid_retrieval_enabled=true` 且有 `ctx.queryUnderstandingResult` → 呼叫 `HybridRetrievalService.retrieve(plan, 5)` → 呼叫 `decideFromChunks()` → 填入 `ctx.retrievalDecision`；同時 map chunks → `ctx.ragResults` 保持下游相容
- [ ] T061 [US2] 在 `src/chat/chat-pipeline.service.ts` 實作 Step 6 legacy path 擴充：`feature.hybrid_retrieval_enabled=false` + `feature.no_answer_gate_enabled=true` → 現有 `PostgresRetrievalService.retrieve()` 完成後，額外呼叫 `decideFromRetrievalResults()` 填入 `ctx.retrievalDecision`（`feature.hybrid_retrieval_enabled=false` 不讓 Gate 失效）

### Step 6.5 — No-answer Gate

- [ ] T062 [US2] 在 `src/chat/chat-pipeline.service.ts` 新增 `applyNoAnswerGate(ctx)` 方法：`feature.no_answer_gate_enabled=false` → skip（return true）；`ctx.retrievalDecision.canAnswer=false` → 寫 fallback SSE、寫 AuditLog（`llmCalled=false`）、return false 中止管線

### Step 10 — LLM Gate Condition

- [ ] T063 [US2] 更新 `src/chat/chat-pipeline.service.ts` Step 10：`feature.no_answer_gate_enabled=true` 且 `answerMode=llm|hybrid_rag` 時，**須確認 `canAnswer=true`** 才呼叫 LLM；`canAnswer=false` 時強制 `answerMode=fallback`，`llmCalled=false`

### ChatPipeline Integration Tests

- [ ] T064 [US2] 擴充 `src/chat/chat-pipeline.service.spec.ts`，新增以下測試情境：
  - feature flags 全 false → 行為與 002 完全相同，現有 mocks 不調整
  - `quV2Enabled=true` → `ctx.queryUnderstandingResult` 填入，`ctx.analyzedQuery` 仍存在
  - `hybridEnabled=false, gateEnabled=true` → legacy `RetrievalResult[]` 產生 `ctx.retrievalDecision`
  - `hybridEnabled=false, gateEnabled=true`，legacy 零命中 → `canAnswer=false`，fallback SSE，`llmCalled=false`
  - `hybridEnabled=false, gateEnabled=true`，legacy 低分 → `canAnswer=false`，`llmCalled=false`
  - `hybridEnabled=true, gateEnabled=true`，`canAnswer=false` → fallback，`llmCalled=false`，LLM 未呼叫
  - `gateEnabled=true`，`canAnswer=true`，`answerMode=template` → `llmCalled=false`
  - `gateEnabled=true`，`canAnswer=true`，`answerMode=llm` → `llmCalled=true`
  - `gateEnabled=true`，`canAnswer=false`，原本 answerMode=llm → Gate 阻擋，最終 `answerMode=fallback`，`llmCalled=false`

**Phase 4 Checkpoint**：`npx jest src/chat` 全數通過；手動驗收：`POST /api/v1/chat/sessions/:sessionToken/messages` SSE 事件結構向下相容

---

## Phase 5: Traceability + AuditLog V2

**目標**：`GeneratedAnswer.sourceReferences` 始終存在；`feature.traceable_answer_enabled=true` 時 `trace` 填入；AuditLog V2 欄位加法性新增

**獨立測試**：送出可命中知識條目的查詢，AuditLog 包含 `sourceReferences`（非空陣列）；`answerMode=fallback` 時 `sourceReferences=[]`；`feature.traceable_answer_enabled=false` 時 `trace` 不存在但 `sourceReferences` 仍存在（SC-006 / SC-004）

### 核心型別

- [ ] T065 [P] [US4] 建立 `src/chat/types/source-reference.type.ts`（`SourceReference`：`knowledgeEntryId?`、`chunkId?`、`sourceKey`、`title?`、`language?`、`category?`、`score?`、`chunkIndex`）
- [ ] T066 [P] [US4] 建立 `src/chat/types/answer-mode.type.ts`（`AnswerMode = 'llm' | 'rag+template' | 'template' | 'hybrid_rag' | 'fallback'`）
- [ ] T067 [P] [US4] 建立 `src/chat/types/generated-answer.type.ts`（`GeneratedAnswer`：`message`、`sourceReferences: SourceReference[]`（始終存在）、`answerMode`、`confidence`、`trace?: AnswerTrace`）
- [ ] T068 [P] [US4] 建立 `src/chat/types/answer-trace.type.ts`（`AnswerTrace`：`queryUnderstandingMs`、`retrievalMs`、`fusionMs`、`llmMs?`、`totalMs`；`ChunkTraceDetail`：`chunkId`、`score`、`retriever`、`tokenType`）
- [ ] T069 [P] [US4] 建立 `src/audit/types/audit-log-v2-payload.type.ts`（`AuditLogV2Payload extends AuditLogPayload`：新增 `queryUnderstanding?`、`retrievalPlan?`、`retrievalCandidates?`、`retrievalDecision?`、`answerMode?`、`sourceReferences?`、`llmCalled`、`canAnswer?`、`fallbackReason?`、`trace?`）

### sourceReferences 建立

- [ ] T070 [US4] 在 `src/chat/chat-pipeline.service.ts` 實作 `buildSourceReferences(chunks: ChunkResult[]): SourceReference[]`（從 `ChunkResult[]` 對映；`chunkIndex` 為陣列索引；`fallback` 時傳入空陣列 `[]`）

### Step 11 — GeneratedAnswer Assembly

- [ ] T071 [US4] 更新 `src/chat/chat-pipeline.service.ts` Step 11（`writeAndReturn`），組裝 `GeneratedAnswer`：填入 `sourceReferences`（所有 answerMode 均填；fallback 時為 `[]`）；填入 `answerMode`；`feature.traceable_answer_enabled=true` 時填入 `trace`

### AuditService V2

- [ ] T072 [US4] 更新 `src/audit/audit.service.ts`，接受並寫入 `AuditLogV2Payload` 中的新增欄位（加法性；不修改現有欄位；舊呼叫端傳入 V1 payload 時正常運作）

### Phase 5 Unit Tests

- [ ] T073 [P] [US4] 擴充 `src/chat/chat-pipeline.service.spec.ts`（`sourceReferences` 在所有 answerMode 均存在；`fallback` 時為空陣列 `[]`；`feature.traceable_answer_enabled=true` 時 `trace` 填入；`false` 時 `trace` 不填入但 `sourceReferences` 仍存在；SSE done payload 向下相容，新欄位不影響未升級客戶端）

**Phase 5 Checkpoint**：SC-006 通過（LLM-generated 答案 AuditLog 含非空 `sourceReferences`）

---

## Phase 6: Regression + Rollout Hardening

**目標**：SC-001 到 SC-007 全數通過；所有 feature flags 逐一驗收；Jieba CI 編譯驗證通過

**驗收基準**：所有 regression suites 通過後才進行 Rollout Phase B–F

### Baseline 驗收

- [ ] T074 確認 `npm test` 全數通過，feature flags 全 false（SC-007）；若失敗，追查並修復 Phase 0–5 引入的 side effect

### Regression Fixtures

- [ ] T075 在 `src/regression/` 建立 / 更新 zh-TW FAQ regression fixtures（20 條）；啟用 `feature.query_understanding_v2_enabled=true`，驗證 `expectedAction=answer|template` 仍符合（SC-002）
- [ ] T076 [P] 在 `src/regression/` 建立 / 更新 en FAQ regression fixtures（10 條）；啟用 QU V2 後，score ≥ `rag_minimum_score`（SC-003）
- [ ] T077 在 `src/regression/` 建立 Jieba fallback regression fixtures（模擬 Jieba init 失敗）；驗證零 500 錯誤（SC-004）
- [ ] T078 [P] 在 `src/regression/` 建立 English tokenizer regression fixtures；`feature.zh_tokenizer=jieba` 啟用後，英文查詢分數不退化（SC-003）
- [ ] T079 在 `src/regression/` 建立 No-answer Gate regression fixtures；`feature.no_answer_gate_enabled=true`，domain-out 查詢 100% `llmCalled=false`（SC-001）
- [ ] T080 [P] 在 `src/regression/` 建立 business_hours fixtures（兩種情境）：KB 無 `business_hours`/`company_info` 內容 → `canAnswer=false`，`llmCalled=false`；KB 有對應內容 → `canAnswer=true`
- [ ] T081 [P] 在 `src/regression/` 建立 traceable answer regression fixtures；`feature.traceable_answer_enabled=true`，LLM-generated 答案 AuditLog 含非空 `sourceReferences`（SC-006）

### CI & Infra

- [ ] T082 確認 CI pipeline 在 build stage 能成功編譯 nodejieba（或選定 Jieba package）；若失敗，於 build 前加入依賴安裝 step 並更新 Dockerfile

### Optional Tasks

- [ ] T083 [P] 建立 `prisma/seeds/backfill-knowledge-documents.seed.ts`（optional script：遍歷 `KnowledgeEntry`，建立對應 `KnowledgeDocument` + `KnowledgeChunk`；`sourceReference='KnowledgeEntry:${entry.id}'`；不修改 `knowledge_entries` 資料）
- [ ] T084 [P] 建立 optional internal retrieval test endpoint `GET /admin/retrieval/test?q=...`（供 QA 手動驗證 retrieval 結果；不對外公開；需 `@UseGuards(JwtAuthGuard)`）

**Phase 6 Checkpoint**：SC-001 to SC-007 全數通過 → 準備 Rollout Phase B

---

## Dependencies（User Story Completion Order）

```
Phase 0（T001–T011）
    └── Phase 1 QU V2 types（T012–T018）
            └── Phase 1 classifiers（T019–T026） [US1, US2]
                    └── Phase 2 tokenizers（T032–T040） [US1, US3, US5]
                            └── Phase 3 hybrid retrieval（T041–T056） [US1, US2]
                                    └── Phase 4 ChatPipeline（T057–T064） [US1, US2]
                                            └── Phase 5 Traceability（T065–T073） [US4]
                                                    └── Phase 6 Regression（T074–T084）
```

### Parallel Opportunities Per Phase

| Phase | 可並行任務群組 |
|-------|-------------|
| Phase 0 | T001–T004（schema），T007–T010（scaffolding）可並行 |
| Phase 1 | T012–T018 型別全部並行；T019–T022 各自並行（T021 依賴 T019+T020）；T027–T031 tests 並行 |
| Phase 2 | T032（EnglishTokenizer）、T033（JiebaTokenizer）、T035（domain dict）可並行；T034（TokenizerProvider）依賴 T032+T033 |
| Phase 3 | T041–T044 型別 + interfaces 並行；T046+T047 可並行；T051–T056 tests 並行 |
| Phase 4 | T059+T060 可並行；T061+T062+T063 需依序（Step 6 → Step 6.5 → Step 10） |
| Phase 5 | T065–T069 型別全部並行；T070+T071+T072 需依序 |
| Phase 6 | T075–T081 regression fixtures 部分並行 |

---

## Implementation Strategy（MVP First）

**MVP（Phase 0–4）**：
- SC-007（baseline 不破壞）
- SC-001（no-answer gate，domain-out → llmCalled=false）
- SC-004（Jieba fallback，零 500）
- US1 + US2 核心路徑可運作

**Increment 2（Phase 5）**：
- SC-006（sourceReferences 始終存在）
- US3（英文查詢）
- US4（traceable answer）

**Hardening（Phase 6）**：
- SC-002 + SC-003（regression baselines）
- US5（Jieba fallback regression fixtures）
- CI Jieba 編譯驗證

---

## Task Summary

| Phase | Task Count | Primary User Stories |
|-------|-----------|---------------------|
| Phase 0 | 11 | — |
| Phase 1 | 20 | US1, US2 |
| Phase 2 | 9 | US1, US3, US5 |
| Phase 3 | 16 | US1, US2 |
| Phase 4 | 8 | US1, US2 |
| Phase 5 | 9 | US4 |
| Phase 6 | 11 | All |
| **Total** | **84** | |
