# 震南官網 AI 客服聊天機器人 — Backend 實作計畫

**版本**：1.4.0 | **建立日期**：2026-04-10 | **狀態**：Draft  
**承接文件**：`spec.md` v1.7.0、`design.md` v1.9.0  
**下游文件**：`task.md`

---

## 0. 本期實作總原則

> **本期（P1）所有功能均在本期實作，不 defer。** 具體而言：SSE / Streaming 主回覆通道、sessionToken 前端識別機制、Widget Config API、Ticket 實體、Feedback API、Dashboard 聚合 API 均屬本期範疇。handoff status 查詢 API、Auth / RBAC、Email 通知、**end session API** 明確延後。

> **Lead API 欄位最終版（spec.md v1.6.0）**：`name`（必填）、`email`（必填）、`company`（選填）、`phone`（選填）、`message`（選填，訪客原始留言）、`language`（選填，前端語系 `zh-TW`/`en`）。

---

## 1. 文件目的

本文件為「震南官網 AI 客服聊天機器人後端系統」的**實作計畫（Plan）**，將 `spec.md` 的功能需求與 `design.md` 的技術設計，轉換為：

- 可執行的實作階段（Phase）與依賴順序
- 每個 Phase 的目標、範圍、產出物與完成條件
- 模組建置的優先順序與依賴關係
- 測試與驗證策略
- 風險控制與應對方向
- Open Questions 的保守預設處理方式
- 明確標記 Deferred 項目

本文件**不展開**過細碎的 task checklist（那是 `task.md` 的職責），也**不重複**需求描述或技術設計細節。

---

## 2. 計畫目標

| # | 目標 |
|---|------|
| P-G1 | 逐 Phase 交付可演示、可驗證的後端能力，不一次性堆砌 |
| P-G2 | 每個 Phase 結束後皆可回退或重整，不造成不可逆累積 |
| P-G3 | 優先打通 P0 主流程，P1 功能在主流程穩定後疊加 |
| P-G4 | 安全防護（Prompt Guard / 機密保護）不可延到最後，需在主流程 Phase 同步建立 |
| P-G5 | LLM observability（token / duration / model / provider）與主流程同時交付，不事後補 |
| P-G6 | 每個 Phase 都包含對應層級的測試，不壓縮到最後一個 Phase |
| P-G7 | 所有 Open Questions 採保守預設值繼續推進，不讓外部待確認事項卡住開發節奏 |

---

## 3. 計畫原則

1. **規則資料底座優先**：先建立 DB 規則表與 seed 機制，再打通業務流程；程式碼中不得硬編碼完整規則清單
2. **Pipeline 先骨架後完整**：先讓 Chat Pipeline 每個步驟跑通，再逐步完善每步驟的細節邏輯
3. **安全不可後補**：Prompt Guard 與機密判斷必須在 Phase 2（聊天主流程）內一起建立，不可在 Phase 3 才接入 Pipeline
4. **LLM observability 隨主流程上線**：token / duration / provider / model 記錄與 LLM 呼叫同時交付
5. **通知採非同步閉環**：Lead 建立為同步操作，Webhook 推送為非同步，兩者解耦
6. **測試隨 Phase 累進**：每個 Phase 都含本 Phase 引入模組的單元 / 整合測試，不壓縮到最後
7. **DB 為規則單一權威**：SafetyRule / BlacklistEntry / IntentTemplate / GlossaryTerm 全部以 DB 為生效來源，seed 只作初始填充

---

## 4. 範圍與前提

### 4.1 本期實作範圍（後端 only）

- 聊天 API 後端：建立 session（回傳 sessionToken）、多輪對話、Chat Pipeline
- **SSE / Streaming 主回覆通道**（逐 token 串流，含 done / error / timeout / interrupted 事件）
- **sessionToken 前端識別機制**（`Conversation.session_token`，前端識別，後端映射至 sessionId）
- Prompt Guard + 機密保護
- Knowledge RAG（`pg_trgm + metadata filter + intent/glossary boost`，含 fallback 策略）
- LLM Provider 抽象（`ILlmProvider`）+ `OpenAiProvider` 實作（含 streaming，本期預設）+ LLM observability
- 問診式推薦流程（四欄位固定順序）
- 高意向偵測（rule-based）
- **Ticket 實體**：人工接手案件追蹤、CRUD、狀態流轉、處理備註（handoff 時建立）
- Lead 建立與 Webhook 通知（DB Outbox + Cron Worker）
- **Feedback API**：訪客對 AI 回覆的評分收集
- **Dashboard 聚合 API**：`GET /api/v1/admin/dashboard`（對話量、Lead 數、Feedback、Ticket 等）
- **Widget Config API**：`GET /api/v1/widget/config`（從 SystemConfig 讀取 Widget 初始化設定）
- 知識庫後台 CRUD API（含版本管理 / 審核流程）
- 對話 / Lead / Ticket / Feedback / AuditLog 查詢 API
- SystemConfig 管理（業務閾值與文案，含 Widget Config keys）
- 稽核日誌（append-only，含 LLM token 觀測欄位）
- 降級模式（AI 失效 fallback）
- Health check endpoint
- DB retention / soft delete / archive 機制

### 4.2 本期排除範圍

- 前端 UI、畫面、元件、樣式、RWD（任何形式）
- Auth / Login / RBAC（明確延後）
- Email 通知（`IEmailProvider` 介面保留，本期不接通）
- 向量語意檢索 / pgvector
- **end session API**（本期不做，前端以 `AbortController.abort()` / connection close 結束串流；無獨立 session 終止端點）
- **handoff status 查詢 API**（本期 handoff = 建立 Lead + Ticket + 回傳 action=handoff；不提供後續輪詢介面）
- 自動封鎖敏感用戶
- Redis / Bull Queue
- Dashboard 前端 / 視覺化報表（後端 API 本期做，前端視覺化介面不在後端範疇）
- 多租戶架構

### 4.3 先決條件

| 條件 | 說明 | 是否阻擋開發 |
|------|------|------------|
| Postgres 14+ 環境 | 基礎開發環境 | 是（必須在 Phase 0 完成）|
| `pg_trgm` 擴充支援 | 主要 RAG 策略的 DB 擴充 | **否**（可先用 ILIKE fallback 開發，部署前確認）|
| LLM provider API key | LLM 呼叫所需；本期預設 OpenAI，使用 `LLM_API_KEY` 環境變數 | 是（Phase 2 開始前必須取得）|
| Webhook 接收端 endpoint | 通知閉環所需 | **否**（Phase 5 之前可用本地 mock 接收端開發與測試）|
| 甲方機密關鍵字清單 | SafetyRule / BlacklistEntry seed 完整性 | **否**（先用保守預設佔位，後續由甲方補充）|
| 問診模板內容細節 | `IntentTemplate` seed 的完整範本文字 | **否**（四欄位結構已拍板，範本文字先用預設值，甲方補充後 DB 更新即可）|

---

## 5. 實作策略總覽

```
Phase 0：基礎骨架與共用能力
  ↓
Phase 1：規則資料底座與知識治理基礎
  ↓
Phase 2：聊天主流程 MVP（含 Prompt Guard + LLM observability）
  ↓
Phase 3：安全強化與機密保護完整實作
  ↓
Phase 4：問診式推薦與高意向留資
  ↓                              ← Phase 4 與 Phase 5 可部分並行
Phase 5：Lead / Webhook / 交接閉環
  ↓
Phase 6：知識庫後台與查詢 API
  ↓
Phase 7：品質補強與驗收準備
```

**關鍵排序說明**：
- Phase 1 必須在 Phase 2 之前完成（規則資料底座是 Pipeline 執行的前提）
- Phase 3 與 Phase 2 有部分重疊——Phase 2 建立 Pipeline 骨架時即需接入 PromptGuard 骨架；Phase 3 進行完整規則完善
- Phase 4 和 Phase 5 的 **Lead 建立** 部分可在 Phase 4 問診完成後直接接入，不必等 Phase 5 全部完成
- **Lead / Webhook 閉環不依賴問診完成才能存在**：`user_request`、`confidential_refuse`、`handoff` 均可直接觸發 Lead 建立；問診（`high_intent`）只是其中一種觸發來源，Phase 5 可先以其他觸發途徑完整驗證
- Phase 6 可在 Phase 2 完成後並行推進（不依賴問診或通知）
- Phase 7 為全面收尾，不可提前宣告完成

---

## 6. 里程碑（Milestones）

| 里程碑 | 達成條件 | 對應 Phase 完成 |
|-------|---------|----------------|
| **M0：骨架可跑** | 應用啟動無錯誤、DB 連線正常、Health endpoint 可用、基本 migration 可執行 | Phase 0 |
| **M1：規則資料可管** | seed 執行成功、SafetyService / IntentService 規則快取正常載入、KnowledgeEntry 基礎資料模型與 retrieval-ready 條件（`findForRetrieval()` 強制 visibility + status 過濾）可用 | Phase 1 |
| **M2：聊天可問答（SSE 串流）** | POST /chat 可跑完完整 Pipeline、LLM SSE 串流可推送 token chunk、`event: done` 包含完整 metadata、AuditLog 每筆有 requestId 與 token 欄位；sessionToken 機制可用（建立 session 回傳 sessionToken，路由以 sessionToken 識別）| Phase 2 |
| **M2a：Widget Config 可查詢** | `GET /api/v1/widget/config` 可從 SystemConfig 讀取 Widget 初始化設定並回傳；AI 失效時 status 自動切換 | Phase 2（Widget Config）|
| **M3：安全防護就位** | Prompt Guard 攔截 ≥ 95%（10 種攻擊）、機密題庫 100% 攔截（驗收前樣本測試）| Phase 3 |
| **M4：問診與留資可跑** | 問診四欄位流程跑通、高意向觸發留資引導、Lead 建立正常 | Phase 4 |
| **M5：通知閉環完整 + Ticket + Feedback** | Webhook 推送正常、Cron Worker 重試可用、NotificationDelivery 有記錄；handoff 時 Ticket 同步建立；Feedback API 可接收訪客評分 | Phase 5 |
| **M6：後台查詢可用 + Dashboard** | 知識庫後台 API 可用（含版本管理）、AuditLog / Lead / Ticket / Feedback 查詢可用、`GET /api/v1/admin/dashboard` 回傳聚合指標 | Phase 6 |
| **M7：驗收就緒** | 所有 AC-001 ~ AC-019 有對應測試覆蓋、NFR 可量測項目有驗證記錄 | Phase 7 |

---

## 7. Phase 劃分

---

### Phase 0：基礎骨架與共用能力

#### 目標
建立可啟動、可連線、可測試的 NestJS 後端骨架；確保後續所有 Phase 的基礎設施不需重工。

#### 本階段納入範圍

| 項目 | 說明 |
|------|------|
| NestJS 應用骨架 | `main.ts`、`app.module.ts`、全域 Pipe / Filter / Interceptor 基礎接線 |
| Prisma + Postgres 接線 | `PrismaModule`（global）、`PrismaService`、connection health check |
| GlobalExceptionFilter | ValidationError → 400；BusinessError → 4xx；未知 → 500（不洩露 stack）|
| TransformInterceptor | 統一回傳格式 `{ data: T, code: number, requestId }` |
| Request ID Middleware | 每個 HTTP 請求生成 UUID v4 `X-Request-ID`，貫穿 pipeline 與日誌 |
| Structured Logger | NestJS ConsoleLogger + JSON 格式，含 requestId / sessionId / module / message |
| ConfigModule + 環境變數 | `@nestjs/config` 基礎設定、`.env` / `.env.example` 範本 |
| SystemConfig 基礎機制 | `SystemConfig` 表 migration、`ConfigService` 啟動載入 + in-memory cache |
| HealthModule | `GET /api/v1/health`（DB ping）、`GET /api/v1/health/ai-status`（in-memory degraded 狀態；**此為 internal health / monitoring endpoint，非前端 Widget 正式初始化 contract**；前端 Widget 正式初始化狀態來源只有 `GET /api/v1/widget/config` 的 `status`）|
| Migration 基礎規劃 | Prisma migration 流程確認；`prisma/seeds/` 目錄結構建立（含各子 seed 檔案空殼）|
| `pg_trgm` 啟用確認 | 確認開發環境是否支援；若不支援，確認 ILIKE fallback 策略可正常執行 |
| Rate Limiting | `@nestjs/throttler` 接線；Phase 0 限流參數由 env `RATE_LIMIT_PER_IP_PER_MIN` / `AppConfigService` 讀取（預設 60/min）；`SystemConfig.rate_limit_per_ip_per_min` 保留於 seed / 後續擴充，Phase 0 不要求 runtime 動態更新 |
| Docker / docker-compose 確認 | 確認本地開發容器可正常啟動 Postgres + NestJS |

#### 前置依賴
- Postgres 14+ 環境（本地 Docker 或 cloud）
- Node.js 環境確認

#### 主要產出物

- 可啟動的 NestJS 應用（`npm run start:dev` 無錯誤）
- `PrismaService` 與 DB 連線正常
- `GET /api/v1/health` 回傳 `{ status: "ok", db: "ok" }`
- Global Exception Filter / Transform Interceptor 運作正常
- `prisma/seeds/` 目錄結構建立（含 `seed.ts` 入口 + 5 個子 seed 空殼）
- `.env.example` 含所有必要環境變數佔位符
- 基礎 `SystemConfig` migration 與預設值可執行

#### 完成條件

- [ ] `npm run start:dev` 可無錯誤啟動
- [ ] `GET /api/v1/health` 正常回傳
- [ ] `npx prisma migrate dev` 可執行（含 SystemConfig 表）
- [ ] `npx prisma db seed` 主進入點可執行（即使子 seed 為空）
- [ ] Global Exception Filter 單元測試通過
- [ ] Request ID 出現在所有日誌與回應 header

#### 對應 spec / design 章節
- design.md §5.2 分層定義
- design.md §12.4 Global Exception Filter
- design.md §13.10 SystemConfig
- design.md §16.1 Request ID / Correlation ID
- design.md §16.2 Structured Logging
- design.md §17.1 設定來源層級
- design.md §19.1 部署最小需求

---

### Phase 1：規則資料底座與知識治理基礎

#### 目標
建立所有業務規則的 DB 表結構與 seed 機制；確保規則可從 DB 載入、快取、及後台 API 維護，為 Phase 2 的 Pipeline 執行建立可靠的規則基礎。

#### 本階段納入範圍

| 項目 | 說明 |
|------|------|
| DB Migration | `SafetyRule`、`BlacklistEntry`、`IntentTemplate`、`GlossaryTerm`、`KnowledgeEntry`、`KnowledgeVersion` 表 |
| Seed 實作 | `safety-rules.seed.ts`（injection pattern、jailbreak regex）、`blacklist.seed.ts`（保守預設關鍵字）、`intent-templates.seed.ts`（意圖模板 + keyword）、`glossary-terms.seed.ts`（術語 + 同義詞）|
| `knowledge.seed.ts` | 開發 / 測試用示範知識條目；`seed.ts` 依 `NODE_ENV !== 'production'` 決定是否執行 |
| `SafetyModule` 骨架 | `SafetyService`（規則從 DB 載入至 in-memory cache，含 `invalidateCache()`）、`SafetyRepository` |
| `IntentModule` 骨架 | `IntentService`（意圖模板與詞彙從 DB 載入至 in-memory cache，含 `invalidateCache()`）、`IntentRepository` |
| `KnowledgeModule` 骨架 | `KnowledgeService`（CRUD + visibility 過濾）、`KnowledgeRepository`（`findForRetrieval()` 強制 `status=approved AND visibility=public`）|
| `pg_trgm` migration | 在 migration 中執行 `CREATE EXTENSION IF NOT EXISTS pg_trgm`；若環境不支援，標記使用 ILIKE fallback |
| `content_tsv` 欄位 | `KnowledgeEntry` 中建立 `tsvector` 欄位與 DB trigger（可選優化，Phase 1 先建立結構）|
| Admin API 路由骨架 | `/api/v1/admin/knowledge/`、`/api/v1/admin/system-config/` 路由骨架（DTO + Controller 骨架，Service 後補）|

#### 前置依賴
- Phase 0 完成（Prisma 接線、PrismaModule global）

#### 主要產出物

- 完整的規則表 migration（6 張表）
- `npx prisma db seed` 可成功填充初始規則資料
- `SafetyService` 啟動時可從 DB 載入規則，`scanPrompt()` 方法存在（骨架可接受 input，回傳結構化結果）
- `IntentService` 啟動時可從 DB 載入意圖模板，`detect()` 方法存在
- `KnowledgeRepository.findForRetrieval()` 強制可見性過濾，單元測試通過
- `knowledge.seed.ts` 在 `NODE_ENV=production` 時不執行

#### 完成條件

- [ ] 6 張規則相關表 migration 執行成功
- [ ] `npx prisma db seed` 完整執行（含 NODE_ENV 條件分支測試）
- [ ] `SafetyService` 單元測試：規則從 DB 正確載入；`invalidateCache()` 可觸發重新載入
- [ ] `IntentService` 單元測試：意圖模板與詞彙從 DB 正確載入
- [ ] `KnowledgeRepository` 單元測試：`findForRetrieval()` 無論如何傳入參數，不回傳 `visibility != 'public'` 或 `status != 'approved'` 的條目
- [ ] Seed 資料在開發環境 DB 中可查詢確認

#### 對應 spec / design 章節
- design.md §10.2、§10.2a 規則資料落點與模組責任
- design.md §13.11 GlossaryTerm、§13.12 IntentTemplate
- design.md §14.1 pg_trgm 部署前提
- spec.md NFR-053 規則資料化管理

#### 並行說明
- `KnowledgeModule` 的 Admin API 路由骨架可與 `SafetyModule` / `IntentModule` 並行建立

---

### Phase 2：聊天主流程 MVP（含 SSE 串流 + sessionToken）

#### 目標
打通完整的聊天 Pipeline——從建立 session 到 LLM SSE 串流回覆——每個步驟有骨架並可獨立驗證；同時建立 sessionToken 機制與 Widget Config API；LLM observability 使 AuditLog 每筆記錄均含 token / duration 欄位。

> ⚠️ **安全整合說明**：Prompt Guard 骨架（PromptGuard 步驟接入 Pipeline）必須在本 Phase 實作；規則的完整性在 Phase 3 強化。Phase 2 結束時 Pipeline 中的每個步驟都必須**已接入**，不可是空 stub。

#### 本階段納入範圍

| 項目 | 說明 |
|------|------|
| DB Migration | `Conversation`（含 `session_token` 欄位：UUID, unique, indexed, NOT NULL）、`ConversationMessage`、`AuditLog` 表 |
| `ChatModule` — 建立 session | `POST /api/v1/chat/sessions`（建立 session，生成 session_token，**回傳 sessionToken**，不回傳 sessionId）|
| sessionToken 映射機制 | `ConversationRepository.findBySessionToken(token)`；前端以 sessionToken 識別，後端內部以 session_id（DB PK）關聯所有資料 |
| `ChatModule` — SSE 訊息端點 | `POST /api/v1/chat/sessions/:sessionToken/messages`（Content-Type: text/event-stream）|
| SSE 串流控制器 | NestJS SSE（`@nestjs/platform-express`）；`event: token\ndata: {"token":"..."}` 逐 token 推送；`event: done`（含 `messageId`、`action`、`sourceReferences`、`usage`）、`event: error`、`event: timeout`、`event: interrupted`；前端以 **fetch + ReadableStream** 接收，不使用 EventSource |
| **對話歷史 API** | `GET /api/v1/chat/sessions/:sessionToken/history`；依 sessionToken 回傳該會話 ConversationMessage 列表 |
| **Handoff API** | `POST /api/v1/chat/sessions/:sessionToken/handoff`；訪客主動觸發轉人工；後端建立 Lead 與 / 或 Ticket（`trigger_reason=handoff`）；回傳 `{ accepted, action, leadId, ticketId, message }`；`action` 穩定語意為 `"handoff"`；`leadId` / `ticketId` 為 nullable，依實際建立結果回傳；`accepted = true` 時兩者不得同時為 `null` |
| 取消串流機制 | **AbortController / connection close** 為正式取消機制；不設計獨立 cancel endpoint；`res.on('close')` 感知前端斷線後呼叫 `AbortController.abort()` |
| `ILlmProvider` stream() 方法 | 介面新增 `stream(request, abortSignal?): AsyncIterable<LlmStreamChunk>`；`OpenAiProvider.stream()` 實作 OpenAI streaming（本期預設）；未來可替換為 `ClaudeProvider` |
| Chat Pipeline 骨架 | 完整 Pipeline 骨架接入（InputValidation → LanguageDetection → PromptGuard → ConfidentialityCheck → IntentRecognition → KnowledgeRetrieval → 信心判斷 → Prompt 組裝 → LLM Streaming → 寫入）|
| Language Detection | `franc` 套件整合；`zh-TW` / `en` 偵測；其他 fallback `zh-TW` |
| PromptGuard 接入 | `SafetyService.scanPrompt()` 接入 Pipeline；攔截時以 SSE `event: done` 推送拒答 |
| ConfidentialityCheck 接入 | `SafetyService.checkConfidentiality()` 接入 Pipeline；命中時設定 `type=confidential`、`risk_level=high` |
| `IntentService.detect()` | keyword + 意圖模板 rule-based；意圖路由 |
| `RetrievalModule` | `PostgresRetrievalService.retrieve()`；主方案 `pg_trgm` 查詢（含 `IRetrievalService` 介面）；ILIKE fallback 備用 |
| 信心分數判斷 | `rag_confidence_threshold` / `rag_minimum_score` 來自 `SystemConfig` |
| `LlmModule` | `ILlmProvider` 介面（含 `chat()` + `stream()`）、`OpenAiProvider` 預設實作；`PromptBuilder`；未來可擴充 `ClaudeProvider` |
| LLM Observability | `promptTokens`、`completionTokens`、`totalTokens`、`durationMs`、`model`、`provider` 全部寫入 AuditLog；未呼叫 LLM 時記為 0 |
| `AuditModule` | `AuditService.log()` append-only；含 config_snapshot |
| `AiStatusService` | in-memory degraded 狀態管理 |
| Fallback 機制 | LLM timeout / 5xx / retry 耗盡 → SSE `event: done` 推送 fallback 回覆 |
| **Widget Config API** | `GET /api/v1/widget/config`（公開端點）；從 SystemConfig 讀取 Widget 相關 keys；回傳多語系 JSONB 結構（`welcomeMessage/quickReplies/disclaimer/fallbackMessage` 均為 `{"zh-TW":"","en":""}`）；AI 失效時 `status` 自動切換為 `"degraded"` |
| Widget Config SystemConfig seed | SystemConfig seed 補入 `widget_status`（預設 `online`）、`widget_welcome_message`（JSONB 多語系）、`widget_quick_replies`（JSONB 多語系）、`widget_disclaimer`（JSONB 多語系）、`widget_fallback_message`（JSONB 多語系）|

#### 前置依賴
- Phase 0、Phase 1 完成
- LLM provider API key 已取得（本期預設 OpenAI，使用 `LLM_API_KEY` 環境變數）

#### 主要產出物

- `POST /api/v1/chat/sessions` 可建立 session，回傳 `sessionToken`（不回傳 sessionId）
- `POST /api/v1/chat/sessions/:sessionToken/messages` 以 SSE 串流回覆，逐 token 推送至 `event: done`
- AuditLog 每筆記錄含 `requestId`、`timestamp`、`prompt_tokens`、`total_tokens`、`ai_model`、`ai_provider`
- PromptGuard 和 ConfidentialityCheck 已接入 Pipeline（非空 stub）
- `GET /api/v1/widget/config` 可正確回傳 Widget 初始化設定

#### 完成條件

- [ ] `POST /api/v1/chat/sessions` 建立 session，回傳 `sessionToken`（不含 sessionId）
- [ ] `POST /api/v1/chat/sessions/:sessionToken/messages` SSE 串流執行，`event: token\ndata:` token chunk 推送 + `event: done` 含 `{messageId, action, sourceReferences, usage}`
- [ ] `GET /api/v1/chat/sessions/:sessionToken/history` 可回傳 ConversationMessage 列表
- [ ] `POST /api/v1/chat/sessions/:sessionToken/handoff` 觸發後端建立 Lead 與 / 或 Ticket；回傳 `{ accepted, action: "handoff", leadId, ticketId, message }`；`leadId` / `ticketId` 依實際建立結果回傳（nullable），`accepted = true` 時不得同時為 `null`
- [ ] `sessionToken` 不存在時回傳 404
- [ ] 前端斷線時 `res.on('close')` 觸發 `AbortController.abort()`，LLM streaming 中止
- [ ] AuditLog 每筆：有 `requestId`、`knowledge_refs`、`prompt_tokens` + `total_tokens`
- [ ] PromptGuard 骨架攔截可觸發（攔截時 SSE `event: done` 推送拒答）
- [ ] LLM timeout 時觸發 SSE `event: timeout`，`fallbackTriggered=true`
- [ ] `ChatPipeline` 單元測試（每個 step 獨立 mock + 測試）通過
- [ ] `RetrievalService` 單元測試（信心分數計算、閾值短路邏輯）通過
- [ ] `GET /api/v1/health/ai-status` 在 degraded 狀態時正確回傳
- [ ] `GET /api/v1/widget/config` 單元測試：SystemConfig keys 正確映射至多語系 JSONB 回傳格式；AI degraded 時 `status` 切換為 `degraded`

#### 對應 spec / design 章節
- spec.md FR-001 ~ FR-004b、FR-078
- design.md §8.1 ~ §8.6（Pipeline、SSE Transport、sessionToken 映射、Widget Config）
- design.md §14 檢索與回覆生成設計
- design.md §12 降級與錯誤處理設計
- design.md §16.4 LLM 呼叫成本與可觀測性

#### 並行說明
- `LlmModule` 實作可與 `RetrievalModule` 並行開發（兩者透過介面解耦）
- `AuditModule` 基礎 append-only 寫入可與 Pipeline 骨架並行實作
- Widget Config API 可在 SystemConfig migration 完成後立即並行實作

---

### Phase 3：安全強化與機密保護完整實作

#### 目標
完善 Prompt Guard 與機密保護的規則完整性，確保所有攔截分類可正常觸發；建立對應的稽核事件與拒答模板；達到 spec 的安全驗收條件。

#### 本階段納入範圍

| 項目 | 說明 |
|------|------|
| Prompt Guard 完整規則 | BlacklistEntry 關鍵字比對 / SafetyRule regex pattern 比對 / 已知攻擊 SHA256 hash 比對 |
| 攔截分類完整實作 | `prompt_injection` / `jailbreak` / `blacklist_keyword` / `confidential_topic` / `internal_topic`（見 design.md §10.3）|
| 敏感意圖累積記錄 | `Conversation.sensitive_intent_count += 1`；達 `sensitive_intent_alert_threshold` 時寫入 AuditLog alert 事件 |
| confidential 標記 | `Conversation.type = 'confidential'`、`Conversation.risk_level = 'high'`、`ConversationMessage.type`、`ConversationMessage.risk_level` 正確寫入 |
| 固定拒答模板 | `SafetyService.buildRefusalResponse()`；拒答文字不透過 LLM 生成，由固定模板產生 |
| RAG 層知識隔離強化 | `KnowledgeRepository.findForRetrieval()` 強制 `WHERE status='approved' AND visibility='public'` 確認（可能已在 Phase 1 實作）|
| 安全稽核事件 | `prompt_guard_blocked` / `confidential_refused` / `sensitive_intent_alert` 事件完整寫入 AuditLog |
| Admin API：規則管理 | `POST/PATCH/DELETE /api/v1/admin/safety-rules`、`/admin/blacklist` 可維護規則；更新後呼叫 `invalidateCache()` |
| Prompt Guard 測試集 | 10 種以上攻擊模式的單元 / 整合測試 |
| 機密題庫樣本測試 | 建立至少 10 題機密樣本（含甲方保守預設，等待甲方補充至 50 題）|

#### 前置依賴
- Phase 2 完成（Pipeline 骨架已就位，PromptGuard 已接入）

#### 主要產出物

- `SafetyService.scanPrompt()` 可處理 5 種攔截分類
- 攔截時 AuditLog 有 `blocked_reason`、`prompt_hash`
- 機密題庫樣本 10 題測試通過（100% 攔截，不洩露線索）
- Prompt Injection 10 種攻擊模式測試通過（≥ 95% 攔截）
- Admin 規則維護 API 可運作，`invalidateCache()` 觸發規則重新載入

#### 完成條件

- [ ] `SafetyService` 單元測試：5 種攔截分類各有測試案例
- [ ] Prompt Injection 測試集（≥ 10 種攻擊）：攔截率 ≥ 95%
- [ ] 機密樣本測試集（≥ 10 題）：100% 攔截，拒答訊息不含機密線索
- [ ] AuditLog `blocked_reason` 在所有攔截情境均有寫入
- [ ] `Conversation.type = 'confidential'` 與 `risk_level = 'high'` 在機密觸發時正確設定
- [ ] Admin 規則維護 API 單元測試通過（CRUD + invalidateCache）

#### 對應 spec / design 章節
- spec.md FR-050 ~ FR-056、AC-003、AC-004、AC-015
- spec.md NFR-001 ~ NFR-007
- design.md §10 機密保護與 Prompt Guard 設計

#### 並行說明
- 攔截分類完整實作可與 Admin 規則管理 API 並行
- 機密題庫測試集建立可與程式實作並行準備

---

### Phase 4：問診式推薦與高意向留資

#### 目標
實作問診流程的四欄位固定順序追問邏輯、規格比對與推薦生成；建立高意向偵測機制；銜接留資引導。

#### 本階段納入範圍

| 項目 | 說明 |
|------|------|
| `diagnosis_context` JSONB | `Conversation.diagnosis_context` 欄位 migration（若尚未建立）|
| 問診流程 | `DiagnosisService`（或整合至 `ChatPipeline`）：初始化 context、依 `required_fields` 固定順序追問、欄位填充、`stage` 狀態轉換（`collecting` → `complete` → `recommended`）|
| 問診欄位固定順序 | `purpose → material → length → environment`（不可由 LLM 決定）|
| 規格比對 | `KnowledgeRepository` 以 `intent_label='product-spec'` + `tags` array filter 比對規格知識條目 |
| LLM 推薦摘要 | 規格比對結果 → 呼叫 LLM 生成自然語言推薦文字（LLM 僅負責摘要，不決定規格匹配）|
| 高意向偵測 | `IntentService.isHighIntent()`：rule-based，近 N 輪詢價關鍵字 + `high_intent_score >= high_intent_threshold`（來自 SystemConfig）|
| 留資引導附加 | 高意向觸發時回覆附加留資引導文字；`leadPrompted=true` 在 Response DTO 中標記 |
| 對話摘要 | `SummaryService.generate()`：優先呼叫 LLM；失敗時使用模板 fallback（來自 `ConversationMessage` 歷史拼接）|
| `IntentTemplate` 問診追問範本 | `intent=product-diagnosis` 的雙語追問文字（來自 DB，不可硬編碼）|

#### 前置依賴
- Phase 2 完成（IntentService、ChatPipeline 基礎就位）
- Phase 1 完成（IntentTemplate seed 含問診範本）

#### 主要產出物

- 問診流程可跑通四欄位完整收集流程（含追問、`stage` 轉換）
- 規格比對可從 KnowledgeEntry 取得符合條目
- 高意向偵測觸發時 `leadPrompted=true` 出現在回覆
- 對話摘要 LLM 生成可用（摘要失敗時 template fallback 運作）

#### 完成條件

- [ ] 問診流程單元測試：四欄位依序追問、欄位已填不重複追問、`stage=complete` 後進入比對
- [ ] 規格比對單元測試：`intent_label` / `tags` filter 正確過濾知識條目
- [ ] 高意向偵測整合測試：多輪詢價語句觸發 `leadPrompted=true`
- [ ] 對話摘要 fallback 測試：LLM 失敗時回傳模板摘要，不拋出錯誤
- [ ] `Conversation.diagnosis_context` 在問診過程中逐步更新並可查詢

#### 對應 spec / design 章節
- spec.md FR-020 ~ FR-025、FR-034、AC-018
- design.md §9 問診式推薦流程設計

#### 並行說明
- 對話摘要（SummaryService）可與問診流程並行實作（兩者無直接依賴）
- 高意向偵測邏輯可在 Phase 2 IntentService 骨架上直接疊加

---

### Phase 5：Lead / Webhook / Ticket / Feedback 閉環

#### 目標
完整實作 Lead 建立流程、handoff 時同步建立 Ticket、DB Outbox 通知模式、Cron Worker 推送與重試；建立 Feedback API；確保各閉環端到端可驗證。

#### 本階段納入範圍

| 項目 | 說明 |
|------|------|
| DB Migration | `Lead`、`Ticket`、`Feedback`、`NotificationJob`、`NotificationDelivery` 表 |
| `LeadModule` | `LeadService.createLead()`（建立 Lead + 更新 Conversation + 生成摘要 + 寫入 notification_jobs）、`LeadRepository` |
| 留資 API | `POST /api/v1/chat/sessions/:sessionToken/lead`（接收留資表單）|
| **`TicketModule`** | `TicketService.createTicket()`（handoff 時建立 Ticket，status=open）；Ticket CRUD 後台 API（`GET|PATCH /api/v1/admin/tickets/**`、狀態更新、備註新增）|
| handoff 流程 | handoff 觸發時：`LeadService.createLead()` + `TicketService.createTicket()`；回傳 `{ accepted, action: "handoff", leadId, ticketId, message }`；`leadId` / `ticketId` 依實際建立結果回傳（nullable）；`accepted = true` 時兩者不得同時為 `null`；**無 handoff status 輪詢 API** |
| **`FeedbackModule`** | `FeedbackService.createFeedback()`；`POST /api/v1/chat/sessions/:sessionToken/messages/:messageId/feedback`（訪客評分；`value: "up" | "down"`、`reason?: string`）；`GET /api/v1/admin/feedback/**`（後台查詢）|
| `NotificationModule` | `WebhookProvider`（POST Webhook URL）、`NotificationService`（寫入 notification_jobs）|
| Cron Worker | `@nestjs/schedule` `@Interval(30000)`；`SELECT ... FOR UPDATE SKIP LOCKED`；指數退避重試（60s / 300s）|
| `NotificationDelivery` 記錄 | 每次 Webhook 嘗試 INSERT 一筆；永久保留 |
| Webhook Payload | 含 FR-063 所有欄位（含 `type`、`risk_level`、`sensitiveIntentCount`、`highIntentScore`、`transcriptRef`、`requestId`）|
| Lead 通知狀態更新 | `Lead.notification_status` 依 Webhook 成功 / 失敗更新 |
| `IEmailProvider` 介面保留 | 介面宣告存在，不實作；架構允許未來接入 |
| Lead / Ticket / Feedback AuditLog | `lead_created`、`human_handoff`（含 ticketId）事件寫入 AuditLog |
| 交接資訊完整性 | Lead + Ticket 建立時 `type`、`risk_level` 等從 Conversation 正確帶入 |

#### 前置依賴
- **Phase 2 完成**（ConversationModule、sessionToken 機制、AuditModule 基礎）— 主要依賴
- **Phase 4 完成後疊加**（可選）：問診完成後的高意向觸發（`high_intent`）情境驗證

#### 主要產出物

- `POST /api/v1/chat/sessions/:sessionToken/lead` 可建立 Lead，`notification_jobs` 自動寫入 pending webhook
- handoff 觸發時 Lead + Ticket 同步建立
- Feedback API 可接收訪客評分並持久化
- Cron Worker 啟動後可輪詢 pending jobs，嘗試 Webhook 發送
- Ticket 後台 CRUD API 可用

#### 完成條件

- [ ] `LeadService` 整合測試：Lead 建立後 `notification_jobs` 有一筆 `channel=webhook, status=pending`
- [ ] handoff 觸發時：後端建立 Lead 與 / 或 Ticket（status=open）；回傳 `{ accepted: true, action: "handoff", leadId, ticketId, message }`；`leadId` / `ticketId` 依實際建立結果回傳（nullable）；`accepted = true` 時兩者不得同時為 `null`
- [ ] Ticket 狀態更新 API：`open → in_progress → resolved → closed` 流轉正確
- [ ] Feedback API：`POST /api/v1/chat/sessions/:sessionToken/messages/:messageId/feedback` 可正確儲存評分
- [ ] Cron Worker 測試：pending job 在下次輪詢後被處理，`NotificationDelivery` 有記錄
- [ ] 指數退避測試：失敗後 `next_retry_at` 正確計算
- [ ] 3 次失敗後 `status=failed`，不再觸發重試
- [ ] 並發安全測試：`FOR UPDATE SKIP LOCKED` 防止重複處理
- [ ] `Lead.type` / `Lead.risk_level` 從 Conversation 正確帶入至 Ticket

#### 對應 spec / design 章節
- spec.md FR-060 ~ FR-070c（含 Ticket 相關 FR）、FR-076（Feedback）
- design.md §11 留資 / 轉人工 / 通知流程設計
- design.md §13.7 Ticket、§13.8 Feedback

#### 並行說明
- `FeedbackModule` 可在 Phase 2 ConversationModule 完成後立即並行開發（不依賴 Lead / Ticket）
- Webhook Provider 實作可與 Cron Worker 並行（透過介面解耦）

---

### Phase 6：知識庫後台 / 查詢 API / Dashboard

#### 目標
完整實作知識庫管理後台 API（CRUD、版本管理、審核流程）與各查詢 API；實作 Dashboard 聚合 API；確認後台 API 的部署保護前提。

#### 本階段納入範圍

| 項目 | 說明 |
|------|------|
| `KnowledgeModule` Admin API | `POST /api/v1/admin/knowledge`（新增）、`PATCH /api/v1/admin/knowledge/:id`（更新 → 新版本）、`POST /api/v1/admin/knowledge/:id/approve`（審核）、`POST /api/v1/admin/knowledge/:id/archive`（封存）|
| `KnowledgeVersion` 版本管理 | 更新時舊版本 snapshot 寫入 `KnowledgeVersion`；`KnowledgeEntry.version += 1`；`status` 重設為 `draft` |
| `draft → approved → archived` 流程 | 狀態轉換規則實作；審核通過後 RAG 可用 |
| 對話查詢 Admin API | `GET /api/v1/admin/conversations`（含 sessionToken / 日期範圍 / 意圖標籤 filter）|
| AuditLog 查詢 API | `GET /api/v1/admin/audit-logs`（含 requestId / 日期範圍 / 事件類型 filter）|
| Lead 查詢 Admin API | `GET /api/v1/admin/leads`（含狀態 / 日期範圍 filter）、`PATCH /api/v1/admin/leads/:id/status`（更新 Lead 狀態）|
| Ticket 查詢 Admin API | `GET /api/v1/admin/tickets`（含狀態 / 日期範圍 filter）、Ticket 查詢可用（若 Phase 5 未完整實作）|
| Feedback 查詢 Admin API | `GET /api/v1/admin/feedback`（含 session / 日期範圍 / rating filter）|
| **`DashboardModule`** | `DashboardService.getStats(startDate, endDate)`；`GET /api/v1/admin/dashboard`（聚合：對話量、Lead 數、Ticket 狀態分布、Feedback up/down 統計（`{totalCount, upCount, downCount, upRate}`）、fallback 率、Guard 攔截量等）|
| SystemConfig Admin API | `GET /api/v1/admin/system-config`（查詢所有閾值含 Widget Config keys）、`PATCH /api/v1/admin/system-config/:key`（更新 + invalidateCache + AuditLog）|
| Notification 查詢 API | `GET /api/v1/admin/leads/:id/notifications`（查詢推送記錄）|
| Admin API 部署保護說明 | 確認所有 `/api/v1/admin/` 路由的 IP 白名單 / VPN 保護設定已文件化 |
| Pagination | 查詢 API 統一使用 `PaginationDto`（`page`、`limit`）|

#### 前置依賴
- Phase 1 完成（KnowledgeModule 骨架）
- Phase 2 完成（AuditModule 基礎）
- Phase 5 完成（LeadModule、TicketModule、FeedbackModule、NotificationModule）

#### 主要產出物

- 知識庫後台 CRUD + 版本管理 + 審核流程 API 全部可用
- 對話 / AuditLog / Lead / Ticket / Feedback 查詢 API 可用（含分頁）
- `GET /api/v1/admin/dashboard` 回傳完整聚合指標
- SystemConfig 更新 API 可用（含 AuditLog 記錄 config 前後值）
- 後台 API 部署保護文件確認
- SystemConfig 更新 API 可用（含 AuditLog 記錄 config 前後值）
- 後台 API 部署保護文件確認

#### 完成條件

- [ ] 知識庫 Admin API 整合測試：新增 → 審核 → 可被 RAG 查詢；更新 → `KnowledgeVersion` 記錄舊版本；封存 → `status=archived` 不再出現在 RAG 結果
- [ ] `draft → approved` 後 `findForRetrieval()` 可取得該條目
- [ ] AuditLog 查詢 API：可依 `requestId` 查詢單筆、可依日期範圍 + 事件類型過濾
- [ ] Ticket 查詢 API：可依狀態 / 日期範圍過濾，回傳分頁結果
- [ ] Feedback 查詢 API：可依 session / value（up/down）過濾，回傳分頁結果
- [ ] `GET /api/v1/admin/dashboard`：回傳包含對話量、Lead 數、Feedback `{upCount, downCount, upRate}`、Ticket 狀態分布等指標
- [ ] SystemConfig 更新 API：AuditLog 有記錄前後值 snapshot
- [ ] `knowledge.seed.ts` 在 `NODE_ENV=production` 執行 seed 時確認跳過

#### 對應 spec / design 章節
- spec.md FR-070 ~ FR-077（含 FR-077 Dashboard API）
- spec.md NFR-008（後台 API 保護）
- design.md §13.4 ~ §13.5 KnowledgeEntry / KnowledgeVersion
- design.md §14a Dashboard 聚合 API 設計
- design.md §19.2 後台 API 保護

#### 並行說明
- AuditLog / Lead / Conversation 查詢 API 可在 Phase 2、5 完成後立即並行開發
- Dashboard API 可在 Phase 5 完成（有 Ticket / Feedback 資料）後並行實作

---

### Phase 7：品質補強與驗收準備

#### 目標
補齊所有 spec AC-001 ~ AC-019 對應的測試覆蓋；完成效能驗證準備；補強 failure path 與 retention 機制；確保文件與操作說明完整。

#### 本階段納入範圍

| 項目 | 說明 |
|------|------|
| AC 測試補齊 | 對照 spec AC-001 ~ AC-019，確認每條 AC 有對應測試並可量測 |
| 機密題庫完整測試 | 50 題機密題庫（甲方補充後）全數執行，確認 100% 攔截 |
| Prompt Injection 測試集 | ≥ 30 題（10 種以上攻擊模式），攔截率 ≥ 95% |
| 雙語測試集 | 中英各 25 題（共 50 題），語言偵測正確率 ≥ 95%，回覆語言與輸入一致 |
| 效能驗證準備 | P90 latency 測試腳本（50 concurrent sessions）；驗證 ≤ 3s 首次回應 / ≤ 5s 一般回答 / ≤ 2s fallback |
| Fallback / Failure Path 補強 | 所有 §12.1 Failure Path 矩陣中的情境均有測試覆蓋 |
| Retention / Soft Delete / Archive | `deleted_at` / `archived_at` 欄位確認存在；1 年自動刪除邏輯（或 Cron Job 骨架）確認 |
| LLM Token / Cost Observability 檢查 | 確認所有 LLM 呼叫（含摘要生成）均有 token 欄位寫入 AuditLog |
| `.env.example` 最終確認 | 所有環境變數佔位符完整、Email 相關變數預留但無值 |
| 操作說明 | seed 執行方式、migration 執行方式、Admin API 使用說明、Webhook 接收端設定說明 |
| LLM provider 資料政策確認 | 確認所選 LLM provider（本期 OpenAI）之資料使用政策符合甲方要求，並關閉任何允許 provider 使用甲方資料進行模型訓練的選項 |

#### 前置依賴
- Phase 2 ~ Phase 6 全部完成

#### 主要產出物

- 測試覆蓋報告（AC-001 ~ AC-019 逐條確認）
- P90 latency 測試結果
- 機密 / Prompt Injection 測試集執行結果
- 完整的 `.env.example` 與操作說明文件

#### 完成條件

- [ ] 所有 AC-001 ~ AC-019 有對應測試，且測試通過或說明暫缺原因（如甲方資料待補充）
- [ ] P90 latency：`≤ 3s`（首次）/ `≤ 5s`（一般）/ `≤ 2s`（fallback）壓測記錄存在
- [ ] Prompt Injection 測試集攔截率 ≥ 95%（記錄留存）
- [ ] 機密題庫測試集攔截率 = 100%（記錄留存）
- [ ] 所有 LLM 呼叫路徑的 AuditLog token 欄位確認非 null
- [ ] `Conversation.deleted_at` / `Lead.deleted_at` / `AuditLog.archived_at` 欄位正確存在
- [ ] `knowledge.seed.ts` 在 production 環境不執行確認

#### 對應 spec / design 章節
- spec.md §12 驗收條件（AC-001 ~ AC-019）
- spec.md §9 非功能需求（NFR）
- design.md §18 測試設計
- design.md §19.3 資料保存與刪除規則

---

## 8. 模組實作順序與依賴關係

```
PrismaModule (global) ← 所有模組的基礎
  └── ConfigModule (global) ← 環境變數 + SystemConfig（含 Widget Config keys）
        └── AuditModule ← 被大多數模組呼叫，不依賴業務模組
              ├── SafetyModule ← Phase 1
              ├── IntentModule ← Phase 1
              ├── KnowledgeModule ← Phase 1
              │     └── RetrievalModule ← Phase 2
              ├── ConversationModule ← Phase 2
              ├── LlmModule ← Phase 2（含 streaming）
              ├── WidgetConfigModule ← Phase 2（讀 ConfigModule）
              │
              └── ChatModule ← Phase 2（編排上述所有模組）
                    ├── LeadModule ← Phase 5
                    │     ├── TicketModule ← Phase 5
                    │     └── NotificationModule ← Phase 5
                    │           └── CronWorker ← Phase 5
                    └── FeedbackModule ← Phase 5

DashboardModule ← Phase 6（讀 Lead/Ticket/Feedback/AuditLog）
```

| 模組 | Phase | 依賴 |
|------|-------|------|
| `PrismaModule` | P0 | — |
| `ConfigModule` | P0 | PrismaModule |
| `HealthModule` | P0 | PrismaModule, ConfigModule |
| `AuditModule` | P2 | PrismaModule |
| `SafetyModule` | P1 | PrismaModule, ConfigModule |
| `IntentModule` | P1 | PrismaModule, ConfigModule |
| `KnowledgeModule` | P1 | PrismaModule |
| `RetrievalModule` | P2 | KnowledgeModule, ConfigModule |
| `LlmModule` | P2 | ConfigModule |
| `ConversationModule` | P2 | PrismaModule |
| `WidgetConfigModule` | P2 | ConfigModule |
| `ChatModule` | P2 | 所有上述模組 |
| `LeadModule` | P5 | ConversationModule, AuditModule, ConfigModule |
| `TicketModule` | P5 | LeadModule, ConversationModule |
| `FeedbackModule` | P5 | ConversationModule, PrismaModule |
| `NotificationModule` | P5 | LeadModule, ConfigModule |
| `DashboardModule` | P6 | LeadModule, TicketModule, FeedbackModule, AuditModule |

> `AuditModule` 只被其他模組呼叫，不反向依賴任何業務模組，禁止循環依賴。

---

## 9. 測試與驗證策略

### 9.1 測試層次

| 層次 | 工具 | 原則 |
|------|------|------|
| **Unit Tests** | Jest + `@nestjs/testing` | mock 所有外部依賴（DB、LLM、Webhook）；每個 Service 的核心邏輯均需有單元測試 |
| **Integration Tests** | Jest + `@nestjs/testing` + 測試 DB | 使用獨立測試 schema；mock LLM；驗證 DB 寫入正確性 |
| **E2E Tests** | Jest + supertest | 完整 API 流程；模擬真實 HTTP 請求；LLM 可 mock 或使用低成本模型 |

### 9.2 每個 Phase 的測試節點

| Phase | 測試重點 |
|-------|---------|
| P0 | GlobalExceptionFilter 單元測試；Health endpoint E2E |
| P1 | SafetyService 規則載入單元測試；KnowledgeRepository 可見性過濾單元測試；seed 執行整合測試 |
| P2 | ChatPipeline 每個步驟單元測試（mock 外部）；SSE 串流事件格式測試；sessionToken 映射測試；RetrievalService 信心分數與閾值單元測試；AuditLog append 整合測試；LLM fallback 測試；Widget Config API 單元測試 |
| P3 | Prompt Injection 測試集（≥ 10 種攻擊）；機密樣本測試集（≥ 10 題）；SafetyService 攔截分類單元測試 |
| P4 | DiagnosisService 問診流程單元測試（四欄位順序）；高意向偵測整合測試；摘要 fallback 測試 |
| P5 | LeadService 整合測試（Lead + Ticket 建立）；FeedbackService 整合測試；Cron Worker 重試邏輯測試；並發安全測試 |
| P6 | KnowledgeModule 版本管理整合測試；Admin API 查詢 E2E；Dashboard API 整合測試（聚合指標正確性）|
| P7 | AC-001 ~ AC-019 全覆蓋確認；P90 latency 壓測；50 題機密 / 30 題 Injection 完整測試 |

### 9.3 測試優先序（依 design.md §18.2）

| 優先序 | 項目 |
|--------|------|
| **P0（必先）** | `SafetyService` 單元測試、`RetrievalService` 單元測試、`ChatPipeline` 單元測試、`LeadService` 整合測試 |
| **P1** | `IntentService` 單元測試、Chat API E2E、AuditLog 整合測試 |
| **P2** | 機密 50 題測試集、Prompt Injection 30 題測試集、雙語 50 題測試集 |

### 9.4 測試資料管理

- 測試 DB 使用獨立 schema（`DATABASE_URL` 指向測試 schema）
- `knowledge.seed.ts` 提供測試知識條目，限 `NODE_ENV=test` / `development` 執行
- 機密題庫與 Injection 測試集以 JSON 或 `.spec.ts` 陣列維護，不依賴 DB 資料

---

## 10. 風險與應對策略

| 風險 ID | 風險描述 | 可能性 | 影響 | 應對策略 |
|---------|---------|--------|------|---------|
| **R-001** | LLM provider API latency 不穩定，P90 超過 3s | 中 | 高 | 設定 `LLM_TIMEOUT_MS`（預設 10s）+ retry（最多 2 次）；雙層 fallback 策略（主模型失敗 → `gpt-5.4-nano` → 固定訊息）確保不超時；SSE `event: timeout` 讓前端感知並顯示失效提示 |
| **R-002** | `pg_trgm` 在目標部署環境不可用 | 低〜中 | 中 | ILIKE fallback 策略已實作（design.md §14.1）；調低 `rag_confidence_threshold`（如 0.4）；不阻擋 MVP 開發 |
| **R-003** | 知識庫內容品質不足，RAG 命中率低 | 中 | 高 | Phase 1 先確保核心 FAQ 與產品規格知識條目存在且已審核；知識品質問題屬運營問題，不是技術問題 |
| **R-004** | Prompt Injection 新型攻擊未覆蓋 | 低〜中 | 高 | BlacklistEntry / SafetyRule 設計為可動態更新（後台 API）；不依賴靜態 hardcode 規則 |
| **R-005** | RAG 閾值設定不當導致大量拒答或低信心生成 | 中 | 中 | `rag_confidence_threshold` 來自 SystemConfig（runtime 可調整）；Phase 2 完成後以測試集驗證並調整閾值 |
| **R-006** | 甲方機密關鍵字清單遲遲無法確認 | 中 | 中 | **保守預設**：seed 先提供常見機密觸發詞樣本；後台 API 支援隨時補充；Phase 3 先以樣本測試通過，等甲方補充後再跑完整 50 題 |
| **R-007** | Webhook 接收端格式需求與當前 payload 不一致 | 低〜中 | 低 | payload 結構由 spec.md FR-063 定義；若甲方有調整需求，只需修改 `WebhookProvider.buildPayload()`，不影響 Lead / Notification DB 結構 |
| **R-008** | 單人開發下某些 Phase 範圍過大 | 中 | 中 | Phase 間有明確的「最小可演示」完成條件；可按 Phase 完成條件部分交付，不需等 Phase 全部完成才進入下個 Phase |
| **R-009** | SSE 串流格式與前端對齊不一致（token chunk 事件名稱、done event payload）| 中 | 中 | 優先與前端對齊 SSE 格式；格式以 design.md §8.3~8.4 為準；前端以 fetch + ReadableStream 接收（不使用 EventSource）|
| **R-010** | sessionToken 前端持久化策略未確認（localStorage / sessionStorage）| 中 | 低 | 後端生成 UUID 返回前端；前端持久化策略由前端決定；後端只需確保 sessionToken 存在且有效即可處理請求（OQ-011）|
| **R-011** | Widget Config AI 失效時前端 status 切換行為不符預期 | 低 | 中 | `AiStatusService.degraded` 自動切換 `widget_status` 為 `"degraded"`；與前端 / 甲方確認 offline / degraded 的顯示差異 |

---

## 11. Open Questions / Assumptions

以下事項在文件撰寫時仍未完全確認，本計畫採**保守預設值**繼續推進，不讓這些事項卡住開發節奏。

| # | 問題 | 保守預設 / Assumption | 影響 Phase | 風險 |
|---|------|--------------------|-----------|------|
| OQ-001 | `pg_trgm` 在目標部署環境是否可用？ | **假設可用**；若不可用，ILIKE fallback 已實作 | P2 | 低（不阻擋開發）|
| OQ-002 | 機密關鍵字清單與分級 seed 的完整版本何時由甲方提供？ | 先用保守預設詞彙填充 seed；後台 API 支援動態補充 | P1、P3 | 中（影響 AC-003 完整驗收）|
| OQ-003 | 問診模板的具體範本文字（各欄位的追問語句、雙語版本）由甲方確認的時間點？ | 先用通用追問文字（如「請問您的使用用途是？」）；甲方確認後 DB 更新即可 | P4 | 低 |
| OQ-004 | Webhook 接收端的具體系統與欄位對齊需要多久確認？ | 先用 mock 接收端（本地 HTTP server）開發與測試；FR-063 payload 已定義 | P5 | 低 |
| OQ-005 | HMAC Webhook 簽名是否需要啟用？ | **本期不強制**；若接收端需要，`WEBHOOK_SECRET` 環境變數已預留，後端架構支援 | P5 | 低 |
| OQ-006 | 後台 API 的 IP 白名單 / 反向代理由誰設定與維護？何時確認？ | 僅限本地或完全封閉的開發環境可暫不設限制；**任何可被外部存取的環境，均不得在未加反向代理 + IP 白名單（或等效基礎設施保護）前暴露 `/api/v1/admin/**`**；此為部署前提，不是選項 | P6 | 中（部署前提）|
| OQ-007 | `sensitive_intent_alert_threshold` 應設幾次？ | SystemConfig 預設值 `3`；可在 Admin API 調整 | P3 | 低 |
| OQ-008 | 資料保存期限（1 年）是否符合甲方 / 法務 / 資安要求？ | 預設 1 年；Soft delete + archived_at 機制建立；正式部署前由甲方確認 | P6、P7 | 低 |
| OQ-009 | SSE 串流事件格式（token chunk、done/error/timeout/interrupted 事件名稱與資料結構）是否與前端對齊？ | 以 design.md §8.4 為準；Phase 2 開始前與前端確認格式，避免雙端各自實作後再調整 | P2 | 中 |
| OQ-010 | sessionToken 前端持久化策略（localStorage / sessionStorage）與斷線重連策略？ | 後端只生成 UUID 返回前端；前端持久化策略由前端決定；後端只需確保 sessionToken 有效性檢查（404 when not found）| P2 | 低 |
| OQ-011 | Widget Config `status` 欄位初始值與 AI 失效時的自動切換行為是否符合前端 / 甲方預期？ | SystemConfig `widget_status=online`（預設）；AI 失效時自動切換為 `degraded`；可動態調整 | P2 | 低 |

---

## 12. Deferred / 下一階段項目

以下項目**明確不納入本期**，標記 Deferred 供後續階段規劃參考：

| 項目 | 說明 | 預留擴充點 |
|------|------|-----------|
| **Auth / Login / RBAC** | 後台管理者登入驗證、角色權限控管 | 後台 API 已按 `/api/v1/admin/` prefix 分組，便於後續接入 AuthGuard |
| **Email 通知** | Lead 建立後通知業務 / 客服 | `IEmailProvider` 介面已保留；`.env.example` 預留 `EMAIL_PROVIDER`、`EMAIL_API_KEY` 等變數 |
| **end session API** | 由前端主動結束 session 的端點；本期以 `AbortController.abort()` / connection close 終止串流為正式機制 | 不設計獨立 cancel / end session endpoint；如有需求後續評估 |
| **向量語意檢索 / 混合檢索** | pgvector / Pinecone 等語意搜尋升級 | `IRetrievalService` 介面隔離，升級不影響 Application Layer |
| **handoff status 查詢 API** | 前端輪詢 Ticket / handoff 案件狀態 | Ticket 資料模型本期已建立；後續擴充 `GET /api/v1/chat/sessions/:sessionToken/ticket-status` |
| **自動封鎖敏感用戶** | 累積敏感意圖自動觸發封鎖 | `Conversation.sensitive_intent_count` 已記錄，封鎖邏輯待業務規則確認後實作 |
| **ML 意圖分類** | 以機器學習模型替換 rule-based 意圖識別 | `IIntentService` 介面隔離，替換不影響 Pipeline |
| **Redis / Bull Queue 通知架構** | 高吞吐或完整可觀測性的 queue-based 通知架構 | `NotificationJob` Outbox 表保留相容欄位；`INotificationQueue` 介面可切換實作 |
| **多租戶架構** | 支援多個客戶或品牌的租戶隔離 | 所有表可加 `tenant_id` 欄位 |

---

## 13. 完成定義（Definition of Done for Plan Execution）

本計畫「執行完成」的標準定義如下，**所有條件均需達成**方可宣告計畫執行完成：

### 13.1 功能完整性

- [ ] spec.md 所有 **P0 功能需求**均已實作並可演示（含 sessionToken、SSE 串流、Widget Config API）
- [ ] spec.md 所有 **P1 功能需求**均已實作並可演示（含 Ticket、Feedback、Dashboard）
- [ ] spec.md **P2 功能需求**中，FR-056（敏感意圖累積記錄）已實作；handoff status 查詢 API 標記 Deferred

### 13.2 驗收條件覆蓋

- [ ] AC-001 ~ AC-019 每條均有對應測試，且測試結果有記錄
- [ ] AC-003（機密 100% 攔截）有完整測試結果（50 題或保守預設樣本）
- [ ] AC-004（Injection ≥ 95%）有完整測試結果（≥ 30 題）
- [ ] AC-009 / AC-010 / AC-011 P90 latency 有壓測記錄

### 13.3 安全與稽核

- [ ] Prompt Guard 已接入 Pipeline，非空 stub
- [ ] 機密保護已接入 Pipeline，`type` / `risk_level` 在命中時正確標記
- [ ] AuditLog 每筆均含 `requestId`、`timestamp`、`knowledge_refs`（回覆類型）、token 欄位
- [ ] 所有 LLM 呼叫路徑均記錄 `prompt_tokens`、`completion_tokens`、`total_tokens`、`duration_ms`、`ai_model`、`ai_provider`
- [ ] 規則資料無任何硬編碼完整清單，全部以 DB 為權威來源

### 13.4 基礎設施與部署

- [ ] 所有 Secrets 透過環境變數注入，程式碼中無硬編碼
- [ ] `.env.example` 完整，所有必要變數有佔位符
- [ ] `knowledge.seed.ts` 在 `NODE_ENV=production` 時確認不執行
- [ ] 後台 API 的 IP 白名單 / 反向代理保護已文件化（部署前提）
- [ ] Postgres migration 可在乾淨環境從 0 執行至最新版本

### 13.5 可維護性

- [ ] 模組依賴方向符合 design.md §7.4（無循環依賴）
- [ ] SystemConfig 所有業務閾值可透過 Admin API 修改，不需重新部署
- [ ] `IRetrievalService`、`ILlmProvider`、`IEmailProvider`、`IIntentService` 介面均存在，不與具體實作耦合

---

## 14. 附錄

### A. 環境變數清單（參考）

| 變數名稱 | 類別 | 說明 | 本期是否必填 |
|---------|------|------|------------|
| `DATABASE_URL` | DB | Postgres 連線字串 | 是 |
| `LLM_PROVIDER` | LLM | LLM provider 識別（預設 `openai`，未來可設為 `claude`）| 是（Phase 2 起）|
| `LLM_API_KEY` | LLM | LLM provider API key（本期對應 OpenAI API Key）| 是（Phase 2 起）|
| `LLM_MODEL` | LLM | 預設模型（預設 `gpt-5.4-mini`）| 是 |
| `LLM_MAX_TOKENS` | LLM | 最大 token 數（預設 1000）| 是 |
| `LLM_TIMEOUT_MS` | LLM | 超時設定（預設 10000）| 是 |
| `LLM_BASE_URL` | LLM | 可替換為其他相容端點（選填）| 否 |
| `WEBHOOK_URL` | Webhook | Webhook 接收端 URL | 是（Phase 5 起）|
| `WEBHOOK_SECRET` | Webhook | HMAC 簽名 secret（本期可選）| 否 |
| `WEBHOOK_TIMEOUT_MS` | Webhook | Webhook 超時（預設 5000）| 否 |
| `PORT` | App | 應用埠號 | 否（預設 3000）|
| `NODE_ENV` | App | 環境識別（`development` / `production` / `test`）| 是 |
| `EMAIL_PROVIDER` | Email | Email provider（本期不啟用）| 否 |
| `EMAIL_API_KEY` | Email | Email API Key（本期不啟用）| 否 |
| `LEAD_NOTIFY_EMAIL` | Email | 通知收件人（本期不啟用）| 否 |

### B. Seed 執行流程

```text
NODE_ENV=development 或 test：
  npx prisma db seed
  → seed.ts 主進入點
    → safety-rules.seed.ts（SafetyRule）
    → blacklist.seed.ts（BlacklistEntry）
    → intent-templates.seed.ts（IntentTemplate）
    → glossary-terms.seed.ts（GlossaryTerm）
    → knowledge.seed.ts（開發 / 測試用知識條目）← NODE_ENV 檢查通過後執行

NODE_ENV=production：
  → seed.ts 主進入點
    → safety-rules.seed.ts
    → blacklist.seed.ts
    → intent-templates.seed.ts
    → glossary-terms.seed.ts
    → ⛔ knowledge.seed.ts 跳過（NODE_ENV=production 不執行）
```

### C. Phase 完成條件快速對照

| Phase | 關鍵 checkpoint |
|-------|----------------|
| P0 | 應用啟動 + Health endpoint 可用 |
| P1 | Seed 執行成功 + 規則快取可載入 |
| P2 | 聊天 API 跑完 Pipeline + AuditLog 有 token 欄位 |
| P3 | Prompt Injection ≥ 95% + 機密樣本 100% 攔截 |
| P4 | 問診四欄位流程跑通 + 高意向觸發留資引導 |
| P5 | Lead 建立 + Webhook 推送 + Cron Worker 重試運作 |
| P6 | 知識庫後台 API + 審核流程 + 查詢 API 可用 |
| P7 | AC-001 ~ AC-019 全覆蓋 + 效能驗證記錄 |

---

## 修訂記錄

| 版本 | 日期 | 修訂摘要 |
|------|------|---------|
| 1.0.0 | 2026-04-10 | 初版建立，承接 spec.md v1.3.0 + design.md v1.5.0；涵蓋 Phase 0~7、里程碑、模組依賴、測試策略、風險管理、Open Questions、Deferred 項目與 DoD |
| 1.1.0 | 2026-04-10 | 依 10 項拍板結果同步修訂（承接 spec.md v1.4.0 + design.md v1.6.0）：①新增§0 本期實作總原則；②§4.1 範圍：新增 SSE/streaming、sessionToken、Ticket、Feedback、Dashboard、Widget Config；③§4.2 排除：移除 Streaming 回覆，新增 handoff status 查詢 API 為排除項，移除 Ticket 實體化；④里程碑：M2 更新為 SSE 串流，新增 M2a Widget Config，M5 納入 Ticket + Feedback，M6 納入 Dashboard；⑤Phase 2 全面更新：SSE 串流控制器、ILlmProvider.stream()、sessionToken 機制、Widget Config API；⑥Phase 5 更新：新增 TicketModule、FeedbackModule，handoff 同步建立 Ticket；⑦Phase 6 更新：新增 DashboardModule、Ticket/Feedback 查詢 API；⑧模組依賴表：新增 TicketModule / FeedbackModule / WidgetConfigModule / DashboardModule；⑨測試 Phase 表更新；⑩風險表：新增 R-009/R-010/R-011；⑪§11 Open Questions：新增 OQ-009/010/011；⑫§12 Deferred：移除 Streaming/Ticket/Dashboard/Feedback，新增 handoff status API |
| 1.2.0 | 2026-04-13 | 最後一輪 API contract 對齊修訂（承接 spec.md v1.5.0 + design.md v1.7.0）：①承接文件版本更新；②Phase 2：SSE 事件格式改為 `event: token` 前綴，done event payload 精簡（messageId/action/sourceReferences/usage），明確前端以 fetch+ReadableStream 接收，取消串流以 AbortController/connection close 為正式機制（無 cancel endpoint）；③Phase 2 新增 Handoff API（`POST .../handoff`）與 History API（`GET .../history`）任務項目；④Phase 2 Widget Config seed/response 改為 JSONB 多語系結構，AI 失效時 status 改為 `degraded`；⑤Phase 5 FeedbackModule：評分改為 `value: "up"|"down"`，移除 rating；⑥Phase 6 DashboardModule：feedbackSummary 改為 `{totalCount,upCount,downCount,upRate}`；⑦風險 R-009 更新（fetch+ReadableStream，不使用 EventSource）；⑧風險 R-011 + OQ-011：widget_degraded_status 移除，改為 `status: degraded` |
| 1.3.0 | 2026-04-14 | 依 spec.md v1.6.0 同步對齊（承接 spec.md v1.6.0 + design.md v1.8.0）：①承接文件版本更新；②§0 總原則：新增 Lead 欄位最終版（name/email 必填，company/phone/message/language 選填），end session API 明確延後；③§4.2 排除範圍：新增 end session API；④§12 Deferred：新增 end session API 條目 |
| 1.3.1 | 2026-04-14 | 最後一輪一致性小幅修補（承接 design.md v1.8.0）：①handoff response contract 統一——Phase 2 / Phase 5 表格與完成條件改為 `{ accepted, action: "handoff", leadId, ticketId, message }`，補充 nullable 語意（accepted=true 時兩者不得同時為 null）；②`GET /api/v1/health/ai-status` 明確標示為 internal health / monitoring endpoint，非前端 Widget 正式初始化 contract，前端正式初始化狀態來源只有 `GET /api/v1/widget/config` 的 `status` |
| 1.4.0 | 2026-04-16 | LLM provider 抽象化修訂（承接 spec.md v1.7.0 + design.md v1.9.0）：①§0 總原則：`OpenAI 實作` → `ILlmProvider` + `OpenAiProvider 預設實作（未來可擴充 ClaudeProvider）`；②§4.1 範圍描述更新；③前置依賴：`OpenAI API Key` → `LLM provider API key（LLM_API_KEY）`；④Phase 2 ILlmProvider.stream() 表格與 LlmModule 更新：加入 `ClaudeProvider` 可擴充備注；⑤Phase 2 完成條件：`OpenAI streaming 中止` → `LLM streaming 中止`；⑥Phase 7 checklist：`OpenAI Data Opt-out` → `LLM provider 資料政策確認`；⑦R-001 風險：`OpenAI API latency` → `LLM provider API latency`，補充雙層 fallback 策略；⑧附錄 A env var 表：`OPENAI_API_KEY` 拆為 `LLM_PROVIDER` + `LLM_API_KEY`，模型預設 `gpt-4o-mini` → `gpt-5.4-mini`，`LLM_BASE_URL` 說明 provider-neutral |

**版本**：1.4.0 | **建立日期**：2026-04-10 | **狀態**：Draft
