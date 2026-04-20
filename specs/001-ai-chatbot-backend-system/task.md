# 震南官網 AI 客服聊天機器人 — Backend 工程任務清單

**版本**：1.4.0 | **建立日期**：2026-04-10 | **狀態**：Draft  
**承接文件**：`spec.md` v1.7.0、`design.md` v1.9.0、`plan.md` v1.4.0

---

## 0. 本期實作總原則

> 本期（spec.md v1.7.0 / design.md v1.9.0 / plan.md v1.4.0）明確定案下列事項：

- **SSE 串流回覆** 為本期正式主流程（非延後），所有聊天回覆一律走 `text/event-stream`
- **取消串流以 `AbortController.abort()` / connection close 為正式機制**；不設計獨立 cancel endpoint
- **sessionToken**（UUID）為前端唯一識別符；後端內部以 `Conversation.id`（sessionId）處理；兩者透過 `session_token` 欄位對映
- **SSE 事件格式最終版**：`event: token\ndata: {"token":"..."}` / `event: done\ndata: {messageId, action, sourceReferences, usage}` / `event: error\ndata: {code, message}` / `event: timeout\ndata: {message}` / `event: interrupted\ndata: {message}`
- **Widget Config API**（`GET /api/v1/widget/config`）為本期正式交付項目；`status` 只用 `online / offline / degraded`；所有文案欄位為多語系 JSONB 結構（`{"zh-TW":"...","en":"..."}`）
- **`GET /api/v1/health/ai-status`** 是 **internal health / monitoring endpoint**，非前端 Widget 正式初始化 contract；前端 Widget 正式初始化狀態來源只有 `GET /api/v1/widget/config` 的 `status`；實作時不得以 `ai-status` 作為前端 Widget 的正式初始化依賴
- **Ticket 實體**（含完整 CRUD 與 Admin API）為本期正式交付項目；狀態流 `open → in_progress → resolved → closed`（四段，不簡化）
- **Feedback API** 為本期正式交付項目；評分使用 `value: "up" | "down"`，不使用 1-5 分制
- **Lead API 欄位最終版**：`name`（必填）、`email`（必填）、`company`（選填）、`phone`（選填）、`message`（選填，訪客原始留言）、`language`（選填，前端語系 `zh-TW`/`en`）
- **Handoff API**：`POST /api/v1/chat/sessions/:sessionToken/handoff`；回傳 `{ accepted, action, leadId, ticketId, message }`；`action` 穩定語意為 `"handoff"`；`leadId` / `ticketId` 為 nullable，依實際建立結果回傳；`accepted = true` 時兩者不得同時為 `null`；handoff 觸發後，後端建立 Lead 與 / 或 Ticket，`leadId` / `ticketId` 依實際建立結果回傳；`/lead` API 成功時 `leadId` 不可為 `null`
- **end session API 本期不做**：前端以 `AbortController.abort()` / connection close 結束串流；不設計獨立 session 終止端點
- **Dashboard 聚合查詢 API** 為本期正式交付項目；`feedbackSummary` 格式為 `{totalCount, upCount, downCount, upRate}`
- **handoff status 查詢 API** 明確排除本期
- **Auth / RBAC / Email 通知** 明確排除本期，介面保留待後續
- **所有 API prefix 統一為 `/api/v1/...`**（無例外）

---

## 1. 文件目的

本文件為「震南官網 AI 客服聊天機器人後端系統」的**工程任務清單（Task List）**，將 `plan.md` 的各 Phase 轉為可逐步執行、可驗證、可勾選的工程任務。

本文件：

- 以 Phase 分組呈現所有可落地的實作任務
- 每個任務標明對應模組、依賴關係與驗收重點
- 測試任務跟隨功能任務出現，不集中壓縮至最後
- 對 Open Questions 採保守預設值，不讓任務懸空
- **不涵蓋**前端 UI、畫面、元件、樣式、RWD
- **不涵蓋**本期明確排除的 Auth / Login / RBAC

---

## 2. 任務拆分原則

1. **可提交粒度**：每個任務約等於 1 個有意義的 commit 單位，可獨立完成、可驗證
2. **不過大**：「完成聊天系統」此類任務不可接受，需進一步拆分
3. **不過碎**：「新增一個 enum 值」此類任務可合併到上層任務
4. **依賴明確**：前置依賴的任務必須先完成，才可開始後續任務
5. **測試隨行**：每個功能模組的測試任務緊接在實作任務後出現
6. **保守預設**：對待確認事項（甲方清單、問診模板文字等），任務採用保守預設值執行，並在任務說明中標記

### 任務標記說明

| 標記 | 說明 |
|------|------|
| `CORE` | 核心主流程 |
| `SAFE` | 安全 / 機密 |
| `DATA` | 資料模型 / migration / seed |
| `INTG` | 外部整合 |
| `TEST` | 測試 |
| `OPS` | 部署 / 設定 / 環境 |
| `ADMIN` | 後台 API |

---

## 3. 執行順序說明

```
Phase 0（基礎骨架）
  ↓ 全部完成
Phase 1（規則資料底座）
  ↓ 全部完成
Phase 2（聊天主流程 MVP）
  ↓ 全部完成
Phase 3（安全強化完整實作）
  ↓ 全部完成
Phase 4（問診與高意向留資）
  ↓ T4 與 T5 可部分並行（Phase 2 完成後即可開始 T5-001 ~ T5-003）
Phase 5（Lead / Webhook / 閉環）
  ↓ 全部完成
Phase 6（後台管理 API）
  ↓ 全部完成
Phase 7（品質補強與驗收準備）
```

**關鍵說明**：
- Phase 1 必須在 Phase 2 前全部完成（規則資料底座是 Pipeline 前提）
- Phase 2 的 PromptGuard 骨架必須在 Phase 2 內完成，不可延至 Phase 3
- Phase 3 完善規則邏輯，不是初次接入
- Phase 5 的 DB model 任務（T5-001 ~ T5-003）可在 Phase 2 完成後立即開始，不需等 Phase 4
- Phase 6 可在 Phase 2 完成後部分並行（查詢 API 部分），核心知識庫後台需等 Phase 1 骨架就位

---

## 4. Phase-by-Phase 任務清單

---

## Phase 0：基礎骨架與共用能力

> **目標**：建立可啟動、可連線、可測試的 NestJS 後端骨架  
> **里程碑**：M0 — 骨架可跑  
> **前置依賴**：Postgres 14+ 環境（Docker or cloud）、Node.js 環境

---

- [X] **T0-001** `OPS` **確認本地開發環境與容器**
  - 說明：確認 `docker-compose.yml` 可正常啟動 Postgres；確認 Node.js 版本符合 NestJS v11 需求；確認 `.env` 可正確讀取
  - 輸出物：`docker-compose.yml`（含 postgres service）、`.env`（本地用，不 commit）
  - 驗收：`docker compose up -d` 後 Postgres 可連線；`npm run start:dev` 不因缺少環境變數而崩潰

- [X] **T0-002** `OPS` **建立 `.env.example` 初版**
  - 說明：列出所有必要環境變數佔位符（`DATABASE_URL`、`NODE_ENV`、`PORT`、`LLM_PROVIDER`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_MAX_TOKENS`、`LLM_TIMEOUT_MS`、`LLM_BASE_URL`、`WEBHOOK_URL`、`WEBHOOK_SECRET`、`EMAIL_PROVIDER` 等），Email 相關預留但無値
  - 輸出物：`.env.example`
  - 驗收：所有 Phase 0 所需變數均有佔位符；Email / HMAC 相關變數預留標記

- [X] **T0-003** `CORE` **建立 NestJS 應用骨架與全域模組接線**
  - 說明：確認 `main.ts`、`app.module.ts` 結構正確；接入全域 `ValidationPipe`（`class-validator`、`whitelist: true`、`forbidNonWhitelisted: true`）；接入全域 `TransformInterceptor`（回傳格式統一為 `{ data: T, code: number, requestId }`）；接入 `GlobalExceptionFilter`（`ValidationError` → 400、`HttpException` → 4xx、未知 → 500，不洩露 stack trace）
  - 輸出物：`src/main.ts`、`src/app.module.ts`、`src/common/interceptors/transform.interceptor.ts`、`src/common/filters/global-exception.filter.ts`
  - 驗收：應用啟動無錯誤；回傳格式符合統一規範；非 HTTP 錯誤不洩露 stack

- [X] **T0-004** `OPS` **建立 ConfigModule 與環境變數管理**
  - 說明：使用 `@nestjs/config` 建立 `ConfigModule.forRoot({ isGlobal: true })`；各模組直接透過 `ConfigService` 注入取得環境變數；確認所有配置從 env 讀取，不可硬編碼
  - 輸出物：`app.module.ts` 中的 `ConfigModule.forRoot({ isGlobal: true })` 設定
  - 驗收：`ConfigService` 可正確取得 `DATABASE_URL`、`NODE_ENV` 等必要值；未設定必要變數時啟動報錯提示明確

- [X] **T0-005** `DATA` **建立 PrismaModule 與 PrismaService**
  - 說明：建立 `PrismaModule`（`isGlobal: true`）、`PrismaService`（繼承 `PrismaClient`，於 `onModuleInit` 連線、`onModuleDestroy` 中斷）；初始化 `prisma/schema.prisma`（含 `SystemConfig` model）
  - 輸出物：`src/prisma/prisma.module.ts`、`src/prisma/prisma.service.ts`、`prisma/schema.prisma`（`SystemConfig` model）
  - 驗收：應用啟動時 Prisma 可成功連線 DB；`PrismaService` 可被 inject 使用

- [X] **T0-006** `DATA` **執行 SystemConfig 首次 migration**
  - 說明：在 `prisma/schema.prisma` 定義 `SystemConfig` 資料表（`key`、`value`、`description`、`updatedAt`）；執行 `npx prisma migrate dev --name init-system-config`；建立對應 seed 初始值（rate limit、RAG 閾值、fallback 訊息等業務閾值）
  - 輸出物：`prisma/migrations/`（首次 migration）、`prisma/seeds/` 目錄（含 `seed.ts` 主進入點 + 5 個子 seed 空殼）
  - 驗收：`npx prisma migrate dev` 執行成功；`npx prisma db seed` 主進入點可執行（子 seed 為空時不報錯）

- [X] **T0-007** `CORE` **建立 Request ID Middleware**
  - 說明：每個 HTTP 請求注入 UUID v4 `X-Request-ID`（優先讀取 request header 中的值，不存在則生成）；將 `requestId` 掛載至 request 物件，供後續 Logger 與 Response 使用
  - 輸出物：`src/common/middleware/request-id.middleware.ts`
  - 驗收：所有 HTTP 回應 header 含 `X-Request-ID`；日誌輸出含對應 `requestId`

- [X] **T0-008** `OPS` **建立 Structured Logger**
  - 說明：使用 NestJS 內建 `Logger` 或 `ConsoleLogger`，輸出 JSON 格式日誌（含 `timestamp`、`requestId`、`sessionId`（可選）、`module`、`level`、`message`）；`NODE_ENV=production` 時僅輸出 `warn` 以上等級
  - 輸出物：`src/common/logger/app-logger.service.ts`（或 logger 設定）
  - 驗收：`npm run start:dev` 日誌為 JSON 格式；每筆日誌含 `requestId`（middleware 注入後）

- [X] **T0-009** `DATA` **建立 SystemConfigService（in-memory cache + 啟動載入）**
  - 說明：`SystemConfigService` 於模組 init 時從 DB 載入所有 `SystemConfig` key-value 至 in-memory cache；提供 `get(key: string): string`、`getNumber(key: string): number` 等方法；提供 `invalidateCache()` 供後台 API 更新後呼叫
  - 輸出物：`src/system-config/system-config.service.ts`、`src/system-config/system-config.module.ts`
  - 驗收：應用啟動時可從 DB 載入 SystemConfig 值；`get('rag_confidence_threshold')` 回傳正確值

- [X] **T0-010** `CORE` **建立 HealthModule**
  - 說明：實作 `GET /api/v1/health`（DB ping 回傳 `{ status: "ok", db: "ok" }`）；實作 `GET /api/v1/health/ai-status`（回傳 `{ aiStatus: "normal" | "degraded" }`，初始値 `"normal"`；**此端點為 internal health / monitoring 用途，非前端 Widget 正式初始化 contract**；前端 Widget 正式初始化狀態來源只有 `GET /api/v1/widget/config` 的 `status`）；`AiStatusService` 為 in-memory 狀態管理，Phase 2 實作 degraded 邏輯時注入
  - 輸出物：`src/health/health.controller.ts`、`src/health/health.module.ts`、`src/health/ai-status.service.ts`
  - 驗收：`GET /api/v1/health` 回傳 200 + 正確格式；DB 連線中斷時回傳 503；`GET /api/v1/health/ai-status` 回傳正確格式

- [X] **T0-011** `OPS` **接入 Rate Limiting（@nestjs/throttler）**
  - 說明：安裝 `@nestjs/throttler`；接入 `ThrottlerModule`，Phase 0 限流參數由環境變數 `RATE_LIMIT_PER_IP_PER_MIN` 透過 `ConfigService` 讀取（預設 60/min）；套用至全域路由；`SystemConfig.rate_limit_per_ip_per_min` 保留於 seed 作為後續擴充來源，Phase 0 不要求 runtime 動態更新（後續如需後台改設定即時生效，再改成 custom throttler guard + `SystemConfigService`）
  - 輸出物：`app.module.ts` 的 throttler 設定
  - 驗收：同 IP 在 1 分鐘內超過限制後回傳 429；`RATE_LIMIT_PER_IP_PER_MIN` 可透過 env 調整（需重啟生效）

- [X] **T0-012** `OPS` **確認 pg_trgm 可用性並準備 fallback 策略**
  - 說明：在開發環境 Postgres 執行 `CREATE EXTENSION IF NOT EXISTS pg_trgm` 確認是否成功；若成功，紀錄環境變數 `PG_TRGM_ENABLED=true`；若不支援，確認 ILIKE fallback 策略設計文件已記錄（OQ-001 保守預設：假設可用，ILIKE fallback 已備用）
  - 輸出物：`.env.example` 中 `PG_TRGM_ENABLED` 佔位符；`README` 或 `docs/` 中的說明
  - 驗收：開發環境可確認 `pg_trgm` 狀態；fallback 策略有文字說明

- [X] **T0-013** `TEST` **Phase 0 測試：GlobalExceptionFilter 單元測試 + Health E2E**
  - 說明：為 `GlobalExceptionFilter` 撰寫單元測試（`ValidationError` → 400、`NotFoundException` → 404、未知 error → 500，stack trace 不外洩）；為 `GET /api/v1/health` 撰寫 E2E 測試（supertest）
  - 輸出物：`src/common/filters/global-exception.filter.spec.ts`、`test/health.e2e-spec.ts`
  - 驗收：所有測試通過；`npm run test` 和 `npm run test:e2e` 無失敗

---

## Phase 1：規則資料底座與知識治理基礎

> **目標**：建立所有業務規則的 DB 表結構、seed 機制與模組骨架  
> **里程碑**：M1 — 規則資料可管  
> **前置依賴**：Phase 0 全部完成

---

- [X] **T1-001** `DATA` **建立規則資料表 Migration（6 張表）**
  - 說明：在 `prisma/schema.prisma` 定義以下 6 張表的 model：`SafetyRule`（`id`、`type`、`pattern`、`isRegex`、`isActive`、`createdAt`）、`BlacklistEntry`（`id`、`keyword`、`isActive`）、`IntentTemplate`（`id`、`intent`、`label`、`keywords`、`templateZh`、`templateEn`、`priority`）、`GlossaryTerm`（`id`、`term`、`synonyms`、`intentLabel`）、`KnowledgeEntry`（`id`、`title`、`content`、`intentLabel`、`tags`、`status`、`visibility`、`version`、`createdAt`、`updatedAt`、`deletedAt`）、`KnowledgeVersion`（`id`、`knowledgeEntryId`、`versionNumber`、`contentSnapshot`、`createdAt`）；執行 migration
  - 輸出物：`prisma/schema.prisma`（更新）、`prisma/migrations/`（新 migration）
  - 驗收：`npx prisma migrate dev` 成功；6 張表可在 DB 查詢

- [X] **T1-002** `DATA` **建立 `pg_trgm` extension migration**
  - 說明：建立獨立 migration，在 migration SQL 中執行 `CREATE EXTENSION IF NOT EXISTS pg_trgm`；在 `KnowledgeEntry` 的 `content` 欄位建立 `gin_trgm_ops` 索引（`CREATE INDEX IF NOT EXISTS idx_knowledge_content_trgm ON knowledge_entries USING GIN (content gin_trgm_ops)`）
  - 輸出物：`prisma/migrations/`（pg_trgm migration）
  - 驗收：migration 在支援環境執行成功；不支援時 `IF NOT EXISTS` 確保不報錯（使用 ILIKE fallback）

- [X] **T1-003** `DATA` **實作 `safety-rules.seed.ts`**
  - 說明：填充初始 `SafetyRule` 資料（至少包含：prompt injection 常見 pattern regex、jailbreak 嘗試 pattern、ignore previous instructions 等 5 種以上）；填充初始 `BlacklistEntry`（至少 10 個保守預設機密觸發關鍵字，OQ-002：等待甲方補充完整清單）
  - 輸出物：`prisma/seeds/safety-rules.seed.ts`、`prisma/seeds/blacklist.seed.ts`
  - 驗收：執行 seed 後 `SafetyRule` 表有初始資料；`BlacklistEntry` 有至少 10 筆；每筆有明確 `type` 標記

- [X] **T1-004** `DATA` **實作 `intent-templates.seed.ts` 與 `glossary-terms.seed.ts`**
  - 說明：填充 `IntentTemplate`（至少包含：`product-inquiry`、`product-diagnosis`、`price-inquiry`、`general-faq` 4 種意圖，每種含中英文追問模板）；問診追問文字採保守預設（OQ-003：甲方確認後透過後台 API 更新即可，不阻擋開發）；填充 `GlossaryTerm`（至少 10 筆產品術語 + 同義詞）
  - 輸出物：`prisma/seeds/intent-templates.seed.ts`、`prisma/seeds/glossary-terms.seed.ts`
  - 驗收：執行 seed 後 `IntentTemplate` 有 4 種以上意圖；`GlossaryTerm` 有至少 10 筆

- [X] **T1-005** `DATA` **實作 `knowledge.seed.ts`（開發 / 測試用）**
  - 說明：建立至少 5 筆示範知識條目（含不同 `intentLabel`、`tags`、`status=approved`、`visibility=public`）；在 `seed.ts` 主進入點以 `NODE_ENV !== 'production'` 條件決定是否執行此 seed
  - 輸出物：`prisma/seeds/knowledge.seed.ts`、`prisma/seed.ts`（更新 NODE_ENV 條件）
  - 驗收：`NODE_ENV=development` 時執行 seed 後知識條目存在；`NODE_ENV=production` 時此 seed 跳過不執行

- [X] **T1-006** `DATA` **完成 `prisma/seed.ts` 主進入點整合**
  - 說明：整合所有子 seed 的呼叫順序（safety → blacklist → intent-templates → glossary-terms → knowledge（conditional））；加入錯誤處理與執行日誌輸出
  - 輸出物：`prisma/seed.ts`（完整版）
  - 驗收：`npx prisma db seed` 一次執行完所有 seed；每個子 seed 執行有日誌輸出；`NODE_ENV=production` 跳過 knowledge seed

- [X] **T1-007** `CORE` **建立 SafetyModule 骨架（SafetyService + SafetyRepository）**
  - 說明：建立 `SafetyModule`；`SafetyRepository`（提供 `findAllRules()`、`findAllBlacklist()` 從 DB 查詢）；`SafetyService`（`onModuleInit` 時呼叫 `loadCache()` 將規則載入 in-memory；提供 `invalidateCache()` 重新載入；提供 `scanPrompt(input: string): SafetyScanResult` 骨架方法（Phase 2 接入 Pipeline，Phase 3 完善規則）；提供 `checkConfidentiality(input: string): ConfidentialityResult` 骨架方法）
  - 輸出物：`src/safety/safety.module.ts`、`src/safety/safety.service.ts`、`src/safety/safety.repository.ts`、`src/safety/types/safety-scan-result.type.ts`
  - 驗收：應用啟動時 `SafetyService` 可從 DB 載入規則；`scanPrompt()` 接受 input 並回傳結構化結果（即使規則邏輯尚未完整）

- [X] **T1-008** `CORE` **建立 IntentModule 骨架（IntentService + IntentRepository）**
  - 說明：建立 `IntentModule`；`IntentRepository`（`findAllTemplates()`、`findAllGlossary()`）；`IntentService`（`onModuleInit` 時載入 in-memory cache；`invalidateCache()`；`detect(input: string, language: string): IntentDetectResult` 骨架方法（keyword 比對 + 意圖路由邏輯，Phase 2 接入 Pipeline）；`isHighIntent(conversationHistory: ConversationMessage[]): boolean` 骨架方法）
  - 輸出物：`src/intent/intent.module.ts`、`src/intent/intent.service.ts`、`src/intent/intent.repository.ts`、`src/intent/types/`
  - 驗收：應用啟動時 `IntentService` 從 DB 載入意圖模板；`detect()` 可接受 input 並回傳結構化結果

- [X] **T1-009** `CORE` **建立 KnowledgeModule 骨架（KnowledgeService + KnowledgeRepository）**
  - 說明：建立 `KnowledgeModule`；`KnowledgeRepository`（`findForRetrieval(query: RetrievalQuery): KnowledgeEntry[]` — 強制帶入 `WHERE status = 'approved' AND visibility = 'public'`，呼叫端無法繞過；`findById()`；`create()`；`update()`）；`KnowledgeService`（封裝 Repository，提供 CRUD 介面）
  - 輸出物：`src/knowledge/knowledge.module.ts`、`src/knowledge/knowledge.service.ts`、`src/knowledge/knowledge.repository.ts`
  - 驗收：`KnowledgeRepository.findForRetrieval()` 無論傳入任何 filter 參數，SQL 查詢一律附帶 `status='approved' AND visibility='public'`

- [X] **T1-010** `CORE` **建立 Admin 路由骨架（Knowledge + SystemConfig）**
  - 說明：建立 `/api/v1/admin/knowledge/` 路由骨架（Controller + DTO + 空實作的 Service 方法）；建立 `/api/v1/admin/system-config/` 路由骨架（Controller + DTO + 空實作）；路由存在但回傳 501 Not Implemented 佔位回應
  - 輸出物：`src/admin/knowledge/`（controller、dto）、`src/admin/system-config/`（controller、dto）
  - 驗收：`GET /api/v1/admin/knowledge` 回傳 501（骨架存在）；路由結構正確，後續 Phase 填充實作

- [X] **T1-011** `TEST` **Phase 1 測試：SafetyService、IntentService、KnowledgeRepository 單元測試**
  - 說明：`SafetyService` 單元測試（mock PrismaService；驗證規則從 DB 正確載入至 cache；`invalidateCache()` 觸發重新載入）；`IntentService` 單元測試（mock；意圖模板正確載入）；`KnowledgeRepository` 單元測試（`findForRetrieval()` 不論傳入參數，不回傳 `visibility != 'public'` 或 `status != 'approved'` 的條目）
  - 輸出物：`src/safety/safety.service.spec.ts`、`src/intent/intent.service.spec.ts`、`src/knowledge/knowledge.repository.spec.ts`
  - 驗收：所有單元測試通過；`findForRetrieval()` 可見性過濾有測試案例覆蓋

- [X] **T1-012** `TEST` **Phase 1 測試：Seed 整合測試（NODE_ENV 條件分支）**
  - 說明：撰寫整合測試確認：`NODE_ENV=development` 時 `knowledge.seed.ts` 被執行；`NODE_ENV=production` 時 `knowledge.seed.ts` 被跳過；seed 執行後各資料表有正確初始資料
  - 輸出物：`test/seed.integration-spec.ts`（或 `prisma/seed.spec.ts`）
  - 驗收：NODE_ENV 條件測試通過；seed 資料可在測試 DB 查詢確認

---

## Phase 2：聊天主流程 MVP（SSE 串流 + sessionToken + Widget Config）

> **目標**：打通完整 Chat Pipeline（10 步驟），以 SSE 串流回覆，`sessionToken` 前後端對映；實作 Widget Config 公開 API；含 LLM observability，PromptGuard 骨架接入  
> **里程碑**：M2 — 聊天可問答（SSE）；M2a — Widget Config 可用  
> **前置依賴**：Phase 0、Phase 1 全部完成；LLM provider API key 已取得（本期預設 OpenAI，使用 `LLM_API_KEY` 環境變數）  
> ⚠️ PromptGuard 與 ConfidentialityCheck 必須在本 Phase 接入 Pipeline，不可為空 stub  
> ⚠️ 所有 Chat API 路由一律使用 `sessionToken`（UUID），不對外暴露內部 `sessionId`

---

- [X] **T2-001** `DATA` **建立 Conversation / ConversationMessage / AuditLog Migration**
  - 說明：定義 `Conversation` model（`id`、`sessionId`、`session_token`（UUID，unique，NOT NULL，indexed）、`status`、`type`（normal/confidential）、`riskLevel`、`sensitiveIntentCount`、`highIntentScore`、`diagnosisContext`（JSONB）、`language`、`createdAt`、`updatedAt`、`deletedAt`）；`ConversationMessage` model（`id`、`conversationId`、`role`、`content`、`type`、`riskLevel`、`blockedReason`、`createdAt`）；`AuditLog` model（`id`、`requestId`、`sessionId`、`eventType`、`eventData`（JSONB）、`knowledgeRefs`、`ragConfidence`、`blockedReason`、`promptHash`、`promptTokens`、`completionTokens`、`totalTokens`、`durationMs`、`aiModel`、`aiProvider`、`configSnapshot`（JSONB）、`createdAt`）；執行 migration
  - 輸出物：`prisma/schema.prisma`（更新）、migration 檔案
  - 驗收：migration 執行成功；`Conversation` 含 `session_token` 欄位（UUID UNIQUE NOT NULL）；`AuditLog` 含全部 LLM observability 欄位

- [X] **T2-002** `CORE` **建立 ConversationModule（ConversationService + ConversationRepository）**
  - 說明：`ConversationRepository`（`createSession()`：建立 Conversation 並產生 UUID `session_token`；`findById(sessionId)`；`findBySessionToken(token)`：依 sessionToken 查詢對映的 Conversation；`addMessage()`；`getHistory(sessionId, limit)`；`updateConversation()`）；`ConversationService`（封裝 repository，提供業務層方法）
  - 輸出物：`src/conversation/conversation.module.ts`、`src/conversation/conversation.service.ts`、`src/conversation/conversation.repository.ts`
  - 驗收：可建立 session（回傳含 `session_token`）；`findBySessionToken()` 正確查詢；Prisma transaction 在批次寫入時正常運作

- [X] **T2-003** `CORE` **建立 AuditModule（AuditService append-only 寫入）**
  - 說明：`AuditService.log(event: AuditLogEvent): Promise<void>`（append-only，永不更新或刪除）；`AuditLogEvent` 型別含所有必要欄位（含 `promptTokens`、`completionTokens`、`totalTokens`、`durationMs`、`aiModel`、`aiProvider`）；未呼叫 LLM 時這些欄位記為 `0`；含 `configSnapshot`（記錄當下 RAG 閾值）
  - 輸出物：`src/audit/audit.module.ts`、`src/audit/audit.service.ts`、`src/audit/types/audit-log-event.type.ts`
  - 驗收：`AuditService.log()` 寫入 DB；非 LLM 事件的 token 欄位為 0；不允許 UPDATE / DELETE AuditLog

- [X] **T2-004** `INTG` **建立 LlmModule（ILlmProvider 介面 + OpenAiProvider 實作）**
  - 說明：定義 `ILlmProvider` 介面（`chat(request: LlmChatRequest): Promise<LlmChatResponse>`；`stream(request: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk>`）；`LlmChatRequest` 型別（`messages`、`model`、`maxTokens`、`temperature`）；`LlmChatResponse` 型別（`content` 、`promptTokens`、`completionTokens`、`totalTokens`、`durationMs`、`model`、`provider`）；`LlmStreamChunk` 型別（`token: string`、`done: boolean`；done=true 時含 `usage` 欄位）；`OpenAiProvider` 實作（本期預設 provider，使用 `openai` npm 套件）：`chat()` 非 streaming；`stream()` 使用 OpenAI streaming API（`stream: true`），支援 `AbortSignal` 傳入以中斷；模型預設讀取自 `LLM_MODEL`（本期預設 `gpt-5.4-mini`）；timeout 讀取自 `SystemConfig.llm_timeout_ms`；retry 最多 2 次；雙層 fallback：主模型失敗 → `gpt-5.4-nano` → 固定訊息（「目前 AI 忙糌中，請留下聯絡資訊 / 聯絡業務」）；`fallbackTriggered=true` 寫入 AuditLog；未來可擴充 `ClaudeProvider`（實作同一 `ILlmProvider` 介面）；所有欄位從 API response 正確填充
  - 輸出物：`src/llm/llm.module.ts`、`src/llm/interfaces/llm-provider.interface.ts`、`src/llm/providers/openai.provider.ts`、`src/llm/types/`
  - 驗收：`OpenAiProvider.chat()` 可呼叫 OpenAI API 並回傳正確型別；`OpenAiProvider.stream()` 回傳 `AsyncIterable<LlmStreamChunk>`；`AbortSignal` 可中止 streaming；`durationMs` 為實際耗時；token 欄位從 API response 填充；主模型失敗時自動 fallback 至 `gpt-5.4-nano`；`fallbackTriggered=true` 寫入 AuditLog

- [X] **T2-005** `CORE` **建立 RetrievalModule（IRetrievalService 介面 + PostgresRetrievalService 實作）**
  - 說明：定義 `IRetrievalService` 介面（`retrieve(query: RetrievalQuery): Promise<RetrievalResult[]>`）；`PostgresRetrievalService` 實作（主方案：`pg_trgm` similarity query + metadata filter（`intentLabel`、`tags`）+ glossary boost；fallback：ILIKE 查詢；`PG_TRGM_ENABLED` 環境變數控制使用哪種策略）；`RetrievalResult` 型別（`entry`、`score`）；信心分數計算邏輯
  - 輸出物：`src/retrieval/retrieval.module.ts`、`src/retrieval/interfaces/retrieval-service.interface.ts`、`src/retrieval/services/postgres-retrieval.service.ts`、`src/retrieval/types/`
  - 驗收：`retrieve()` 回傳依信心分數排序的結果；`pg_trgm` 不可用時自動 fallback 至 ILIKE；`intentLabel` / `tags` filter 正確作用

- [X] **T2-006** `CORE` **建立 PromptBuilder**
  - 說明：`PromptBuilder.build(context: PromptBuildContext): LlmMessage[]`；組裝 system prompt（含語言指令：`zh-TW` 回繁中、`en` 回英文）；注入 RAG context（知識條目摘要）；控制 context window（總 token 數不超過 `SystemConfig.llm_max_context_tokens`）；多輪歷史截斷策略
  - 輸出物：`src/chat/prompt-builder.ts`、`src/chat/types/prompt-build-context.type.ts`
  - 驗收：輸出的 messages 格式符合 LLM provider API 規格（本期為 OpenAI）；RAG context 正確注入；歷史超長時截斷不報錯

- [X] **T2-007** `CORE` **建立 Chat Pipeline 10 步驟骨架（SSE 串流輸出）**
  - 說明：建立 `ChatPipelineService`，實作完整 10 步驟流程（每步驟為獨立 private method，可單獨 mock 測試）：
    1. `validateInput()`（DTO 驗證，訊息長度上限來自 SystemConfig）
    2. `detectLanguage()`（`franc` 套件；`zh-TW` / `en`；其他 fallback `zh-TW`）
    3. `runPromptGuard()`（呼叫 `SafetyService.scanPrompt()`；命中時短路、透過 SSE 送 `event: error` 或固定拒答 token chunk + `event: done`）
    4. `checkConfidentiality()`（呼叫 `SafetyService.checkConfidentiality()`；命中時設定 `type=confidential`、`riskLevel=high`）
    5. `detectIntent()`（呼叫 `IntentService.detect()`）
    6. `retrieveKnowledge()`（呼叫 `RetrievalService.retrieve()`）
    7. `evaluateConfidence()`（比對 `SystemConfig.rag_confidence_threshold`；低於閾值時跳過 LLM 呼叫）
    8. `buildPrompt()`（呼叫 `PromptBuilder.build()`）
    9. `callLlmStream()`（呼叫 `ILlmProvider.stream()`；逐 chunk 推送 `event: token\ndata: {"token":"..."}`；完成後送 `event: done\ndata: {messageId, action, sourceReferences, usage}`；timeout → `event: timeout\ndata: {"message":"string"}`；error → `event: error\ndata: {code, message}`；中斷 → `event: interrupted\ndata: {"message":"string"}`）
    10. `writeAndReturn()`（串流完成後寫入完整 ConversationMessage + AuditLog；AuditLog 含 token observability）
  - 輸出物：`src/chat/chat-pipeline.service.ts`
  - 驗收：每步驟可被個別 mock 測試；PromptGuard / ConfidentialityCheck 均為非空實作（呼叫真實 SafetyService）；SSE 串流正確推送 token chunks

- [X] **T2-008** `CORE` **建立 ChatModule 與 Chat API endpoints（SSE + sessionToken + history + handoff）**
  - 說明：`ChatController`（`POST /api/v1/chat/sessions`：建立 session，產生 UUID `sessionToken`，回傳 `{ sessionToken, createdAt }`（不回傳內部 sessionId）；`POST /api/v1/chat/sessions/:sessionToken/messages`：依 sessionToken 解析內部 sessionId → 呼叫 Pipeline → 以 `Content-Type: text/event-stream` 回傳 SSE 串流；`GET /api/v1/chat/sessions/:sessionToken/history`：依 sessionToken 回傳 ConversationMessage 列表；`POST /api/v1/chat/sessions/:sessionToken/handoff`：訪客主動觸發轉人工，後端建立 Lead 與 / 或 Ticket（`trigger_reason=handoff`），回傳 `{ accepted, action: "handoff", leadId, ticketId, message }`；`leadId` / `ticketId` 依實際建立結果回傳（nullable），`accepted = true` 時不得同時為 `null`）；斷線偵測：`res.on('close', () => abortController.abort())`；取消串流以 AbortController/connection close 為正式機制，**不設計獨立 cancel endpoint**）；SSE 事件格式：`event: token\ndata: {"token":"..."}` / `event: done\ndata: {messageId, action, sourceReferences, usage}` / `event: error\ndata: {code, message}` / `event: timeout\ndata: {message}` / `event: interrupted\ndata: {message}`；`action` enum：`"answer" | "handoff" | "fallback" | "intercepted"`
  - 輸出物：`src/chat/chat.controller.ts`、`src/chat/chat.module.ts`、`src/chat/dto/`、`src/chat/types/`
  - 驗收：`POST /api/v1/chat/sessions` 回傳 201 + `sessionToken`（UUID）；SSE stream 含正確事件格式；`GET .../history` 回傳 ConversationMessage 列表；`POST .../handoff` 觸發 Lead 與 / 或 Ticket 建立，`accepted = true` 時 `leadId` / `ticketId` 不得同時為 `null`；sessionToken 不存在時回傳 404

- [X] **T2-009** `CORE` **實作 AiStatusService degraded 邏輯與 fallback 機制**
  - 說明：`AiStatusService` 追蹤連續 LLM 失敗次數；達 `SystemConfig.ai_degraded_threshold`（預設 3）後設定 `status=degraded`；`GET /api/v1/health/ai-status` 回傳 degraded 狀態；degraded 時 Pipeline 跳過 LLM，透過 SSE 直接推送 fallback 回覆（`fallback_message_zh` / `fallback_message_en` 來自 SystemConfig）後送 `event: done`；degraded 時 `GET /api/v1/widget/config` 的 `status` 自動切換為 `"degraded"`
  - 輸出物：`src/health/ai-status.service.ts`（更新）、`src/chat/chat-pipeline.service.ts`（更新）
  - 驗收：LLM 連續 timeout 3 次後 degraded 啟動；fallback 回覆語言與輸入語言一致；AuditLog 記錄 fallback 事件；Widget Config `status` 在 degraded 時回傳 `"degraded"`

- [X] **T2-010** `INTG` **實作 LLM Observability 完整寫入 AuditLog**
  - 說明：確認 Pipeline 中每次 LLM 呼叫結束後，`LlmChatResponse` 的 `promptTokens`、`completionTokens`、`totalTokens`、`durationMs`、`model`、`provider` 全部寫入 AuditLog；未呼叫 LLM 的 turn（被 PromptGuard 攔截、低信心跳過 LLM）記 0；摘要生成（Phase 4 SummaryService）呼叫 LLM 時亦需寫入 AuditLog
  - 輸出物：`src/chat/chat-pipeline.service.ts`（更新）、`src/audit/audit.service.ts`（確認）
  - 驗收：每筆 AuditLog 的 token 欄位：LLM 呼叫時為正整數；未呼叫 LLM 時為 0；`durationMs` 為實際測量值

- [X] **T2-011** `TEST` **Phase 2 測試：ChatPipeline 各步驟單元測試**
  - 說明：為 `ChatPipelineService` 的每個步驟撰寫獨立單元測試（mock 所有外部依賴 — DB、LLM、SafetyService、IntentService、RetrievalService）；測試案例覆蓋：正常流程、PromptGuard 短路、ConfidentialityCheck 命中、信心低於閾值跳過 LLM、LLM timeout fallback
  - 輸出物：`src/chat/chat-pipeline.service.spec.ts`
  - 驗收：所有步驟均有測試；各短路路徑有對應測試案例；mock 正確隔離外部依賴

- [X] **T2-012** `TEST` **Phase 2 測試：RetrievalService 信心分數與閾值單元測試**
  - 說明：`PostgresRetrievalService` 單元測試（mock DB；信心分數計算正確；閾值短路邏輯正確；pg_trgm 結果與 ILIKE fallback 結果格式一致）
  - 輸出物：`src/retrieval/services/postgres-retrieval.service.spec.ts`
  - 驗收：信心分數計算有測試覆蓋；fallback 邏輯有測試覆蓋

- [X] **T2-013** `TEST` **Phase 2 測試：AuditLog 整合測試 + LLM fallback 測試**
  - 說明：整合測試（使用測試 DB）：Pipeline 執行後 AuditLog 有正確的 token 欄位寫入；LLM timeout 時 SSE 送 `event: timeout` 且 AuditLog 有 fallback 事件記錄；`GET /api/v1/health/ai-status` degraded 後正確回傳
  - 輸出物：`test/audit-log.integration-spec.ts`、`test/chat-pipeline.integration-spec.ts`
  - 驗收：整合測試通過；所有 LLM 呼叫路徑的 AuditLog token 欄位非 null

- [X] **T2-014** `DATA` **Widget Config SystemConfig migration 與 seed**
  - 說明：新增 Widget Config 相關 SystemConfig key-value seed；使用 JSONB 多語系結構：`widget_status`（預設 `"online"`）、`widget_welcome_message`（JSONB：`{"zh-TW":"歡迎使用震南客服，請問有什麼可以幫您？","en":"Welcome! How can I help you today?"}`）、`widget_quick_replies`（JSONB：`{"zh-TW":["查詢產品規格","聯絡業務","其他問題"],"en":["Product specs","Contact sales","Other"]}`）、`widget_disclaimer`（JSONB：`{"zh-TW":"本服務由 AI 提供，回覆僅供參考。","en":"This service is AI-powered. Responses are for reference only."}`）、`widget_fallback_message`（JSONB：`{"zh-TW":"目前服務暫時無法使用，請稍後再試或留下聯絡資訊。","en":"Service temporarily unavailable. Please try again later or leave your contact info."}`）；在 `prisma/seeds/widget-config.seed.ts` 建立；整合至 `seed.ts` 主進入點（生產環境也執行）
  - 輸出物：`prisma/seeds/widget-config.seed.ts`、`prisma/seed.ts`（更新）
  - 驗收：執行 seed 後 DB 含 5 個 Widget Config key；每個 JSONB 欄位均含 `zh-TW` 與 `en` 語系；`widget_status` 預設為 `"online"`

- [X] **T2-015** `CORE` **建立 WidgetConfigModule 與 Widget Config API**
  - 說明：`WidgetConfigService.getConfig()` 從 `SystemConfigService` 讀取所有 `widget_*` 前綴 key，組裝回傳物件；`WidgetConfigController` 實作 `GET /api/v1/widget/config`（公開端點，無需 Auth；`Cache-Control: no-store`）；回傳格式：
    ```json
    {
      "status": "online" | "offline" | "degraded",
      "welcomeMessage": { "zh-TW": "string", "en": "string" },
      "quickReplies": { "zh-TW": ["string"], "en": ["string"] },
      "disclaimer": { "zh-TW": "string", "en": "string" },
      "fallbackMessage": { "zh-TW": "string", "en": "string" }
    }
    ```
    AI 失效（`AiStatusService.degraded=true`）時，`status` 自動回傳 `"degraded"`
  - 輸出物：`src/widget-config/widget-config.module.ts`、`src/widget-config/widget-config.service.ts`、`src/widget-config/widget-config.controller.ts`
  - 驗收：`GET /api/v1/widget/config` 回傳 200 + 正確多語系格式；DB 值更新後下次請求即時反映；AI degraded 時 `status` 回傳 `"degraded"`

- [X] **T2-016** `TEST` **Phase 2 測試：SSE 串流、sessionToken、Widget Config、history、handoff 測試**
  - 說明：SSE 串流單元測試（mock LLM stream）：`event: token` + `data: {"token":"..."}` token chunks 依序推送；`event: done` 含 `{messageId, action:"answer"|"handoff"|"fallback"|"intercepted", sourceReferences, usage}`；`event: timeout\ndata: {"message":"string"}` 在 LLM timeout 時觸發；前端斷線時 AbortController 被呼叫（無 cancel endpoint）；sessionToken 測試：`POST /api/v1/chat/sessions` 回傳 UUID sessionToken；`findBySessionToken()` 正確解析；sessionToken 不存在時 404；`GET /api/v1/chat/sessions/:sessionToken/history` 回傳 ConversationMessage 列表；`POST /api/v1/chat/sessions/:sessionToken/handoff` 觸發後端建立 Lead 與 / 或 Ticket，回傳 `{ accepted, action: "handoff", leadId, ticketId, message }`；`accepted = true` 時 `leadId` / `ticketId` 不得同時為 `null`；Widget Config 測試：`GET /api/v1/widget/config` 回傳多語系 JSONB 格式；AI degraded 時 `status` 切換為 `"degraded"`
  - 輸出物：`src/chat/sse-stream.spec.ts`、`src/conversation/conversation.repository.spec.ts`（更新）、`src/widget-config/widget-config.controller.spec.ts`
  - 驗收：SSE 事件格式、sessionToken 對映、history API、handoff API、Widget Config 多語系讀取的測試均通過

---

## Phase 3：安全強化與機密保護完整實作

> **目標**：完善 PromptGuard 規則、攔截分類、機密保護邏輯，達到 spec 安全驗收條件  
> **里程碑**：M3 — 安全防護就位  
> **前置依賴**：Phase 2 全部完成（Pipeline 骨架與 PromptGuard 骨架已接入）

---

- [X] **T3-001** `SAFE` **完善 SafetyService.scanPrompt() 完整攔截分類邏輯**
  - 說明：實作 5 種攔截分類完整邏輯：
    1. `prompt_injection`（regex pattern 比對 SafetyRule DB；已知攻擊 SHA256 hash 比對）
    2. `jailbreak`（jailbreak pattern regex 比對）
    3. `blacklist_keyword`（BlacklistEntry 關鍵字比對，大小寫不敏感）
    4. `confidential_topic`（機密觸發詞比對）
    5. `internal_topic`（內部資訊觸發詞比對）
    
    命中時回傳 `{ blocked: true, category, blockedReason, promptHash }`；未命中回傳 `{ blocked: false }`
  - 輸出物：`src/safety/safety.service.ts`（完整實作）
  - 驗收：5 種攔截分類各有測試案例；`promptHash`（SHA256）在每次攔截時正確計算

- [X] **T3-002** `SAFE` **完善 SafetyService.checkConfidentiality() 與固定拒答模板**
  - 說明：`checkConfidentiality()` 比對機密觸發詞（來自 BlacklistEntry `type='confidential'`）；命中時 `Conversation.type = 'confidential'`、`Conversation.riskLevel = 'high'`、`ConversationMessage.type`、`ConversationMessage.riskLevel` 正確更新；`SafetyService.buildRefusalResponse(language: string): string` 實作固定拒答模板（中英文，不透過 LLM 生成）；拒答文字不含任何機密線索
  - 輸出物：`src/safety/safety.service.ts`（更新）、拒答模板常數
  - 驗收：機密命中時 Conversation 欄位正確標記；拒答文字固定、不含線索；雙語拒答均有

- [X] **T3-003** `SAFE` **實作敏感意圖累積記錄機制**
  - 說明：`Conversation.sensitiveIntentCount` 在每次攔截（prompt_injection / jailbreak / confidential）時 `+= 1`；達 `SystemConfig.sensitive_intent_alert_threshold`（預設 3，OQ-007 保守預設）時，寫入 AuditLog `sensitive_intent_alert` 事件；同時在 Response DTO 中附加 `handoff` action 引導轉人工（不自動封鎖，OQ 核心方向）
  - 輸出物：`src/safety/safety.service.ts`（更新）、`src/chat/chat-pipeline.service.ts`（更新）
  - 驗收：累積 3 次後 AuditLog 有 alert 事件；不超出閾值時無 alert；`sensitiveIntentCount` 在 DB 正確更新

- [X] **T3-004** `SAFE` **確保 RAG 層知識隔離不洩露機密**
  - 說明：確認 `KnowledgeRepository.findForRetrieval()` 的 `WHERE status='approved' AND visibility='public'` 無法被呼叫端繞過（已在 T1-009 實作，此任務為安全驗收確認）；在 Phase 3 的攔截分類完成後，補充確認：機密拒答路徑不會觸發 `findForRetrieval()`（被短路跳過）
  - 輸出物：測試案例（確認攔截短路後不呼叫 retrieval）
  - 驗收：攔截後的 Pipeline 不執行 KnowledgeRetrieval 步驟；knowledge isolation 測試通過

- [X] **T3-005** `SAFE` **完整安全稽核事件寫入**
  - 說明：確認以下 AuditLog 事件在對應情境正確寫入：`prompt_guard_blocked`（PromptGuard 攔截，含 `blockedReason`、`promptHash`、`category`）；`confidential_refused`（機密拒答，含 `sessionId`、`type`、`riskLevel`）；`sensitive_intent_alert`（累積閾值觸發）
  - 輸出物：`src/audit/audit.service.ts`（確認）、`src/chat/chat-pipeline.service.ts`（確認）
  - 驗收：每種安全事件的 AuditLog 有對應 `eventType` 且欄位完整

- [x] **T3-006** `ADMIN` **實作 Admin 規則管理 API（SafetyRule + BlacklistEntry）**
  - 說明：`POST /api/v1/admin/safety-rules`（新增）；`PATCH /api/v1/admin/safety-rules/:id`（更新）；`DELETE /api/v1/admin/safety-rules/:id`（停用，`isActive=false`）；`POST /api/v1/admin/blacklist`；`PATCH /api/v1/admin/blacklist/:id`；`DELETE /api/v1/admin/blacklist/:id`；每次 CRUD 後呼叫 `SafetyService.invalidateCache()` 觸發重新載入；所有 DTO 含 `class-validator` 驗證
  - 輸出物：`src/admin/safety/safety-admin.controller.ts`、`src/admin/safety/dto/`
  - 驗收：CRUD API 可用；更新後 `invalidateCache()` 被呼叫；快取重新載入後 `scanPrompt()` 使用新規則

- [x] **T3-007** `TEST` **Phase 3 測試：SafetyService 攔截分類單元測試**
  - 說明：為 5 種攔截分類各撰寫至少 2 個測試案例（命中 / 未命中）；`promptHash` SHA256 計算正確；`buildRefusalResponse()` 雙語拒答不含機密線索；`checkConfidentiality()` 命中時欄位標記正確
  - 輸出物：`src/safety/safety.service.spec.ts`（更新）
  - 驗收：5 種分類各有測試；`invalidateCache()` 測試通過

- [x] **T3-008** `TEST` **Phase 3 測試：Prompt Injection 測試集（≥ 10 種攻擊模式）**
  - 說明：建立 Prompt Injection 測試集（至少 10 種攻擊模式，如 ignore previous instructions、role play jailbreak、base64 編碼繞過、DAN prompt 等）；以 `it.each` 或 JSON fixture 方式組織；攔截率需 ≥ 95%
  - 輸出物：`test/fixtures/prompt-injection.fixtures.ts`、`test/safety/prompt-injection.spec.ts`
  - 驗收：10 種攻擊模式測試集全部執行；攔截率 ≥ 95%（記錄留存）

- [x] **T3-009** `TEST` **Phase 3 測試：機密題庫樣本測試集（≥ 10 題）**
  - 說明：建立至少 10 題機密樣本測試集（保守預設：OQ-002，等待甲方補充至 50 題；先以 10 題通過 100% 驗收）；測試確認：每題均被攔截（`blocked=true`）；拒答回覆不含任何機密線索；AuditLog 有對應 `confidential_refused` 事件
  - 輸出物：`test/fixtures/confidential-samples.fixtures.ts`、`test/safety/confidential-check.spec.ts`
  - 驗收：10 題樣本 100% 攔截；拒答文字合規；甲方補充後可直接擴充 fixtures 至 50 題再跑

---

## Phase 4：問診式推薦與高意向留資

> **目標**：實作問診四欄位固定追問流程、規格比對、推薦生成、高意向偵測  
> **里程碑**：M4 — 問診與留資可跑  
> **前置依賴**：Phase 2 完成（IntentService、ChatPipeline 基礎）、Phase 1 完成（IntentTemplate seed 含問診範本）

---

- [ ] **T4-001** `DATA` **確認 Conversation.diagnosisContext JSONB 欄位存在**
  - 說明：確認 `Conversation` model 的 `diagnosisContext` 欄位（JSONB，nullable）已在 T2-001 migration 中建立；若尚未建立，補充 migration；定義 `DiagnosisContext` TypeScript 型別（`stage: 'idle' | 'collecting' | 'complete' | 'recommended'`、`collectedFields: Partial<DiagnosisFields>`、`requiredFields: string[]`）
  - 輸出物：`prisma/schema.prisma`（確認）、`src/chat/types/diagnosis-context.type.ts`
  - 驗收：migration 中 `diagnosisContext` 欄位為 JSON 型別；TypeScript 型別有 `stage` 狀態定義

- [ ] **T4-002** `CORE` **實作 DiagnosisService（問診四欄位固定順序流程）**
  - 說明：`DiagnosisService.initContext(): DiagnosisContext`（初始化 context，`stage='idle'`，`requiredFields=['purpose','material','length','environment']`）；`DiagnosisService.processAnswer(context, field, value): DiagnosisContext`（填入欄位、移至下一個缺少的 field）；`DiagnosisService.getNextQuestion(context, language): string`（從 `IntentTemplate` DB 取得對應欄位的追問文字，不可硬編碼；OQ-003 保守預設：先用通用文字）；`DiagnosisService.isComplete(context): boolean`；追問順序強制為 `purpose → material → length → environment`，不可由 LLM 決定
  - 輸出物：`src/chat/diagnosis.service.ts`
  - 驗收：四欄位依序追問；欄位已填不重複追問；`stage` 狀態機轉換正確

- [ ] **T4-003** `CORE` **整合問診流程至 ChatPipeline**
  - 說明：在 Pipeline 的 `detectIntent()` 步驟後，當 intent 為 `product-diagnosis` 時啟動 / 繼續問診流程；`diagnosisContext` 從 Conversation DB 讀取（有則繼續，無則初始化）；問診中每輪回覆為追問訊息，不觸發 RAG / LLM 推薦（直至 `stage=complete`）；問診完成後觸發規格比對；所有 `diagnosisContext` 變更即時寫回 `Conversation`
  - 輸出物：`src/chat/chat-pipeline.service.ts`（更新）
  - 驗收：問診途中回覆為追問文字；完成後進入比對；中途切換話題時 context 正確保留

- [ ] **T4-004** `CORE` **實作規格比對邏輯**
  - 說明：問診完成後，以 `intent_label='product-spec'` + `tags` array filter（`purpose`、`material`、`length`、`environment`）呼叫 `KnowledgeRepository.findForRetrieval()`；取得符合條目後呼叫 LLM 生成自然語言推薦摘要（LLM 只負責文字摘要，不決定規格匹配）；推薦結果寫入 `Conversation.diagnosisContext.stage='recommended'`；`sourceReferences` 含比對到的知識條目 ID
  - 輸出物：`src/chat/chat-pipeline.service.ts`（更新）、`src/knowledge/knowledge.repository.ts`（確認 filter 支援）
  - 驗收：規格比對結果為 approved+public 的知識條目；LLM 摘要結果包含推薦理由；無符合條目時有 fallback 回覆

- [ ] **T4-005** `CORE` **實作高意向偵測（IntentService.isHighIntent）**
  - 說明：`IntentService.isHighIntent(history: ConversationMessage[]): boolean`（rule-based，分析近 N 輪歷史，N 來自 `SystemConfig.high_intent_look_back_turns`，預設 5）；高意向關鍵字（詢價類：「報價」、「多少錢」、「price」、「quotation」等）在 `IntentTemplate` DB 中維護；`highIntentScore` 累計計算；達 `SystemConfig.high_intent_threshold`（預設 2）時回傳 `true`；`Conversation.highIntentScore` 即時更新
  - 輸出物：`src/intent/intent.service.ts`（更新）
  - 驗收：多輪詢價語句觸發 `isHighIntent=true`；閾值可透過 SystemConfig 調整

- [ ] **T4-006** `CORE` **實作留資引導附加邏輯**
  - 說明：在 Pipeline 的 `writeAndReturn()` 步驟，當 `isHighIntent=true` 或 intent 為 `price-inquiry` 時，在回覆末尾附加留資引導文字（來自 `SystemConfig.lead_prompt_text_zh` / `lead_prompt_text_en`）；`leadPrompted=true` 在 Response DTO 中標記；此步驟不建立 Lead（Lead 建立在 Phase 5 的明確 API 觸發）
  - 輸出物：`src/chat/chat-pipeline.service.ts`（更新）
  - 驗收：高意向觸發時 Response DTO `leadPrompted=true`；引導文字語言與輸入語言一致；未觸發時 `leadPrompted=false`

- [ ] **T4-007** `CORE` **建立 SummaryService（LLM 生成 + template fallback）**
  - 說明：`SummaryService.generate(messages: ConversationMessage[], language: string): Promise<string>`；優先呼叫 LLM（`ILlmProvider.chat()`，使用精簡 prompt 生成對話摘要）；LLM 失敗（timeout / error）時 fallback 至模板（取最後 N 筆訊息的 `content` 拼接 + 格式化）；摘要生成的 LLM 呼叫亦寫入 AuditLog（token observability）
  - 輸出物：`src/chat/summary.service.ts`
  - 驗收：LLM 成功時回傳摘要文字；LLM 失敗時回傳 template fallback，不拋出例外；AuditLog 有摘要生成的 LLM token 記錄

- [ ] **T4-008** `TEST` **Phase 4 測試：DiagnosisService 問診流程單元測試**
  - 說明：單元測試（mock IntentTemplate DB）：四欄位依序追問；已填欄位不重複追問；`stage=complete` 後 `isComplete()=true`；中途提供非預期值時正確處理
  - 輸出物：`src/chat/diagnosis.service.spec.ts`
  - 驗收：所有欄位狀態機測試通過；邊界案例有覆蓋

- [ ] **T4-009** `TEST` **Phase 4 測試：高意向偵測整合測試 + 摘要 fallback 測試**
  - 說明：整合測試：多輪詢價語句觸發 `leadPrompted=true`；閾值邊界測試；`SummaryService` fallback 測試：mock LLM 失敗，驗證 template fallback 回傳非空字串，不拋出例外
  - 輸出物：`src/intent/intent.service.spec.ts`（更新）、`src/chat/summary.service.spec.ts`
  - 驗收：高意向測試與摘要 fallback 測試通過

---

## Phase 5：Lead / Webhook / Ticket / Feedback 閉環

> **目標**：完整實作 Lead 建立（handoff 同步建立 Ticket）、DB Outbox 通知、Cron Worker 推送重試；實作 Ticket CRUD 與 Admin API；實作 Feedback 評分 API  
> **里程碑**：M5 — 通知閉環完整；Ticket 與 Feedback 可用  
> **前置依賴**：Phase 2 完成（ConversationModule、AuditModule）為主要依賴；Phase 4 完成後可疊加高意向觸發情境  
> **備注**：T5-001 ~ T5-003 可在 Phase 2 完成後立即開始，不需等 Phase 4

---

- [ ] **T5-001** `DATA` **建立 Lead / NotificationJob / NotificationDelivery / Ticket / Feedback Migration**
  - 說明：`Lead` model（`id`、`sessionId`、`name`（必填）、`email`（必填）、`company`（選填）、`phone`（選填）、`message`（選填）、`language`（選填，如 `zh-TW` / `en`）、`type`（general/confidential）、`riskLevel`、`confidentialityTriggered`、`promptInjectionDetected`、`sensitiveIntentCount`、`highIntentScore`、`summary`（選填，AI 非同步生成）、`transcriptRef`、`notificationStatus`（pending/success/failed）、`createdAt`、`deletedAt`）；`NotificationJob` model（`id`、`leadId`、`channel`（webhook）、`status`（pending/processing/success/failed）、`retryCount`、`nextRetryAt`、`createdAt`、`updatedAt`）；`NotificationDelivery` model（`id`、`notificationJobId`、`attemptedAt`、`statusCode`、`responseBody`、`success`）；`Ticket` model（`id`、`leadId`（FK, nullable）、`sessionId`（FK）、`status` enum：`open / in_progress / resolved / closed`（四段，不可簡化）、`triggerReason`、`summary`、`assignee`（可選）、`notes`（JSONB array）、`resolvedAt`、`createdAt`、`updatedAt`）；`Feedback` model（`id`、`sessionId`（FK）、`messageId`（FK，ConversationMessage）、`value` enum：`up / down`（不使用 1-5 分制）、`reason`（選填，自由文字）、`createdAt`）；執行 migration
  - 輸出物：`prisma/schema.prisma`（更新）、migration 檔案
  - 驗收：migration 執行成功；5 張表含所有欄位；`Lead` 含 `name`（必填）、`email`（必填）、`company`（選填）、`phone`（選填）、`message`（選填）、`language`（選填）；`Ticket.status` 為四段 enum `open/in_progress/resolved/closed`；`Feedback.value` 為 `up/down` enum（不使用整數評分）

- [ ] **T5-002** `CORE` **建立 LeadModule（LeadService + LeadRepository）**
  - 說明：`LeadRepository`（`createLead()`、`findById()`、`updateNotificationStatus()`）；`LeadService.createLead(dto: CreateLeadDto, conversation: Conversation): Promise<Lead>`（建立 Lead → 從 Conversation 帶入 `type`、`riskLevel`、`confidentialityTriggered`、`promptInjectionDetected`、`sensitiveIntentCount`、`highIntentScore` → 呼叫 `SummaryService.generate()` 生成摘要 → 呼叫 `TicketService.createTicket(leadId, sessionId, triggerReason, summary)` 同步建立 Ticket（`status=open`）→ 更新 `Conversation`（標記已留資）→ 呼叫 `NotificationService.enqueue()` 寫入 `notification_jobs`）；`lead_created` + `ticket_created` 事件各自寫入 AuditLog
  - 輸出物：`src/lead/lead.module.ts`、`src/lead/lead.service.ts`、`src/lead/lead.repository.ts`
  - 驗收：Lead 建立後 `notification_jobs` 有一筆 `channel=webhook, status=pending`；同時 `Ticket` 建立（`status=open`）；AuditLog 有 `lead_created` + `ticket_created` 事件；交接欄位從 Conversation 正確帶入

- [ ] **T5-003** `CORE` **實作留資 API（POST /api/v1/chat/sessions/:sessionToken/lead）**
  - 說明：`POST /api/v1/chat/sessions/:sessionToken/lead`（依 sessionToken 查找對應 Conversation；接收 `CreateLeadDto`：`name`（必填）、`email`（必填）、`company?`（選填）、`phone?`（選填）、`message?`（選填）、`language?`（選填，前端語系如 `zh-TW` / `en`））；驗證 session 存在；驗證同一 session 未重複留資；呼叫 `LeadService.createLead()`；回傳 `{ leadId, ticketId, status: 'pending' }`（`leadId` 成功時不可為 `null`）；DTO 使用 `class-validator`
  - 輸出物：`src/chat/chat.controller.ts`（更新）、`src/lead/dto/create-lead.dto.ts`
  - 驗收：API 可建立 Lead（`leadId` 必非 null）；`name` 或 `email` 缺少時回傳 400；重複留資回傳 409；sessionToken 不存在回傳 404；回傳 `leadId`（必非 null）與 `ticketId`

- [ ] **T5-004** `INTG` **建立 NotificationModule 與 WebhookProvider**
  - 說明：定義 `INotificationQueue` 介面（`enqueue(leadId, channel): Promise<void>`）；`NotificationService.enqueue()`（寫入 `notification_jobs`，`status=pending`）；`WebhookProvider.send(payload: WebhookPayload): Promise<WebhookSendResult>`（HTTP POST 至 `WEBHOOK_URL`；timeout 來自 `SystemConfig.webhook_timeout_ms`，預設 5000ms；OQ-004 保守預設：使用 mock 接收端開發，FR-063 payload 已定義）；`IEmailProvider` 介面宣告存在（不實作）
  - 輸出物：`src/notification/notification.module.ts`、`src/notification/notification.service.ts`、`src/notification/providers/webhook.provider.ts`、`src/notification/interfaces/email-provider.interface.ts`
  - 驗收：`enqueue()` 寫入 `notification_jobs`；`WebhookProvider.send()` 可 POST 至指定 URL；`IEmailProvider` 介面存在但不實作

- [ ] **T5-005** `INTG` **實作 Webhook Payload 組裝（FR-063 欄位完整）**
  - 說明：`WebhookProvider.buildPayload(lead: Lead, conversation: Conversation): WebhookPayload`；`WebhookPayload` 包含 FR-063 所有欄位：`event: "lead.created"`、`leadId`、`sessionId`、`customerName`（對應 Lead.name）、`email`（對應 Lead.email）、`company`（選填，可為 null）、`phone`（選填，可為 null）、`message`（選填，對應 Lead.message，訪客原始留言，可為 null）、`language`（選填，對應 Lead.language，如 `zh-TW` / `en`，可為 null）、`summary`（選填，AI 生成，可為 null）、`intent`、`triggerReason`、`type`、`confidentialityTriggered`、`promptInjectionDetected`、`sensitiveIntentCount`、`highIntentScore`、`transcriptRef`、`requestId`、`createdAt`；OQ-005 保守預設：HMAC 簽名本期不強制，`WEBHOOK_SECRET` 環境變數預留
  - 輸出物：`src/notification/providers/webhook.provider.ts`（更新）、`src/notification/types/webhook-payload.type.ts`
  - 驗收：`buildPayload()` 輸出所有 FR-063 欄位（含 `message`、`language`、`summary`）；Lead.name → `customerName`、Lead.email → `email`、Lead.message → `message`、Lead.language → `language` 的映射正確；選填欄位未提供時輸出 `null`；型別定義完整無 `any`

- [ ] **T5-006** `CORE` **實作 Cron Worker（DB Outbox 輪詢 + 指數退避重試）**
  - 說明：安裝 `@nestjs/schedule`；`NotificationWorker.processJobs()` 以 `@Interval(30000)` 執行；使用 `SELECT ... FOR UPDATE SKIP LOCKED` 防止並發重複處理；取得 `status=pending` 且 `nextRetryAt <= now()` 的 jobs；呼叫 `WebhookProvider.send()`；成功：`status=success`、`Lead.notificationStatus=success`；失敗：`retryCount += 1`、計算 `nextRetryAt`（指數退避：第 1 次 60s、第 2 次 300s）、INSERT `NotificationDelivery` 記錄；達最大 retry（3 次）：`status=failed`、`Lead.notificationStatus=failed`
  - 輸出物：`src/notification/notification.worker.ts`、`src/notification/notification.module.ts`（更新）
  - 驗收：Cron Worker 啟動後可輪詢；每次嘗試有 `NotificationDelivery` 記錄；3 次失敗後不再重試

- [ ] **T5-007** `TEST` **Phase 5 測試：LeadService 整合測試**
  - 說明：整合測試（測試 DB）：Lead 建立後 `notification_jobs` 有一筆 pending webhook；交接欄位（`type`、`riskLevel` 等）從 Conversation 正確帶入；AuditLog 有 `lead_created` 事件；重複留資被拒絕
  - 輸出物：`src/lead/lead.service.spec.ts`
  - 驗收：整合測試通過；交接欄位帶入有測試案例覆蓋

- [ ] **T5-008** `TEST` **Phase 5 測試：Cron Worker 重試邏輯 + 並發安全測試**
  - 說明：Cron Worker 單元測試（mock WebhookProvider）：pending job 被處理，`NotificationDelivery` 有記錄；指數退避 `nextRetryAt` 計算正確；3 次失敗後 `status=failed`，不再觸發；並發安全測試：同時觸發多個 worker 輪詢，確認同一 job 不被重複處理（mock `FOR UPDATE SKIP LOCKED`）
  - 輸出物：`src/notification/notification.worker.spec.ts`
  - 驗收：重試邏輯與並發安全測試通過

- [ ] **T5-009** `TEST` **Phase 5 測試：Webhook Payload 欄位完整性測試**
  - 說明：單元測試：`buildPayload()` 輸出包含所有 FR-063 欄位；欄位型別符合定義；`transcriptRef` 為正確 session 參考
  - 輸出物：`src/notification/providers/webhook.provider.spec.ts`
  - 驗收：FR-063 所有欄位有測試覆蓋（含 `message`、`language`、`summary`）；選填欄位為 null 時正確輸出 null；無 undefined 欄位

- [ ] **T5-010** `CORE` **建立 TicketModule（TicketService + TicketRepository）**
  - 說明：`TicketRepository`（`createTicket()`；`findById()`；`findMany(filter: TicketFilter)`；`updateStatus(id, status)`；`addNote(id, noteContent)`（append to JSONB notes array））；`TicketService.createTicket(leadId, sessionId, triggerReason, summary): Promise<Ticket>`（建立 Ticket，`status=open`）；`TicketService.updateStatus(id, status)`（狀態流轉：`open→in_progress→resolved→closed`；非法轉換回傳 400）；`ticket_created` / `ticket_status_changed` 事件寫入 AuditLog
  - 輸出物：`src/ticket/ticket.module.ts`、`src/ticket/ticket.service.ts`、`src/ticket/ticket.repository.ts`、`src/ticket/types/`
  - 驗收：`createTicket()` 建立 status=open；狀態流轉正確；非法轉換有錯誤；notes JSONB append 正確運作

- [ ] **T5-011** `ADMIN` **實作 Ticket Admin API**
  - 說明：`GET /api/v1/admin/tickets`（列表，支援 filter：`status`、`dateFrom`、`dateTo`、`sessionId`；支援分頁）；`GET /api/v1/admin/tickets/:id`（單筆，含 Lead 關聯資訊）；`PATCH /api/v1/admin/tickets/:id/status`（狀態更新，`body: { status }`）；`POST /api/v1/admin/tickets/:id/notes`（新增備注至 JSONB array，`body: { content }`）；所有 DTO 含 `class-validator` 驗證
  - 輸出物：`src/admin/ticket/ticket-admin.controller.ts`、`src/admin/ticket/ticket-admin.service.ts`、`src/admin/ticket/dto/`
  - 驗收：列表 filter 與分頁正確；狀態更新回傳更新後 Ticket；notes 新增後 JSONB array 正確追加

- [ ] **T5-012** `CORE` **建立 FeedbackModule（FeedbackService + FeedbackRepository）**
  - 說明：`FeedbackRepository`（`create()`；`findBySession()`；`findMany(filter: FeedbackFilter)`）；`FeedbackService.createFeedback(sessionToken: string, messageId: string, dto: CreateFeedbackDto): Promise<Feedback>`（依 sessionToken 解析 sessionId；驗證 messageId 屬於該 session；驗證同一 (sessionId, messageId) 未重複評分；建立 Feedback）
  - 輸出物：`src/feedback/feedback.module.ts`、`src/feedback/feedback.service.ts`、`src/feedback/feedback.repository.ts`
  - 驗收：`createFeedback()` 正確建立；重複評分回傳 409；messageId 不屬於 session 時回傳 404

- [ ] **T5-013** `CORE` **實作 Feedback API（POST 評分 + Admin 查詢）**
  - 說明：`POST /api/v1/chat/sessions/:sessionToken/messages/:messageId/feedback`（公開端點；`CreateFeedbackDto`：`value: "up" | "down"`（必填）、`reason?: string`（可選，自由文字）；呼叫 `FeedbackService.createFeedback()`）；Admin 端：`GET /api/v1/admin/feedback`（支援 filter：`value`（up/down）、`dateFrom`、`dateTo`、`sessionId`；分頁）
  - 輸出物：`src/chat/chat.controller.ts`（更新）、`src/admin/feedback/feedback-admin.controller.ts`、`src/admin/feedback/dto/`
  - 驗收：`POST` 端點成功建立評分；`value` 不為 `up` 或 `down` 時回傳 400；Admin 列表 filter 正確；分頁回傳 `total`

- [ ] **T5-014** `TEST` **Phase 5 測試：LeadService + TicketService 整合測試（含 handoff 閉環）**
  - 說明：整合測試（測試 DB）：Lead 建立後 `notification_jobs` 有一筆 pending webhook + `Ticket` 同步建立（`status=open`）；交接欄位（`type`、`riskLevel` 等）從 Conversation 正確帶入；AuditLog 有 `lead_created` + `ticket_created` 事件；重複留資被拒絕（409）；Ticket 狀態流轉正確，非法轉換 400
  - 輸出物：`src/lead/lead.service.spec.ts`（更新）、`src/ticket/ticket.service.spec.ts`
  - 驗收：整合測試通過；handoff 閉環（Lead 與 / 或 Ticket 建立，`leadId` / `ticketId` nullable 語意正確，`accepted = true` 時兩者不同時為 `null`）有測試案例覆蓋

- [ ] **T5-015** `TEST` **Phase 5 測試：Feedback API 測試**
  - 說明：`FeedbackService` 單元測試（mock DB）：`value: "up"` / `"down"` 有效；其他值無效（400）；重複評分 409；messageId 不屬於 session 404；`POST /api/v1/chat/sessions/:sessionToken/messages/:messageId/feedback` E2E 測試；Admin `GET /api/v1/admin/feedback` filter（`value`、`dateFrom`、`dateTo`、`sessionId`）+ 分頁測試
  - 輸出物：`src/feedback/feedback.service.spec.ts`、`test/feedback.e2e-spec.ts`
  - 驗收：所有 Feedback 測試通過；`value` enum 驗證邊界案例有覆蓋

---

## Phase 6：知識庫後台 / 查詢 API / Dashboard

> **目標**：完整知識庫後台 CRUD、版本管理、審核流程；對話 / Lead / Ticket / Feedback / AuditLog 查詢 API；Dashboard 聚合統計 API  
> **里程碑**：M6 — 後台查詢可用；Dashboard API 可用  
> **前置依賴**：Phase 1（KnowledgeModule 骨架）、Phase 2（AuditModule）、Phase 5（LeadModule、TicketModule、FeedbackModule、NotificationModule）  
> **OQ-006**：任何可被外部存取的環境，均不得在未加反向代理 + IP 白名單前暴露 `/api/v1/admin/**`

---

- [ ] **T6-001** `ADMIN` **實作知識庫 Admin API（CRUD + 版本管理）**
  - 說明：`POST /api/v1/admin/knowledge`（新增知識條目，`status=draft`）；`PATCH /api/v1/admin/knowledge/:id`（更新：先將舊版本 snapshot 寫入 `KnowledgeVersion`，`version += 1`，`status` 重設為 `draft`）；`GET /api/v1/admin/knowledge`（列表 + 分頁 + filter）；`GET /api/v1/admin/knowledge/:id`（單筆）；所有 DTO 含 `class-validator` 驗證；`KnowledgeAdminService` 封裝業務邏輯
  - 輸出物：`src/admin/knowledge/knowledge-admin.controller.ts`、`src/admin/knowledge/knowledge-admin.service.ts`、`src/admin/knowledge/dto/`
  - 驗收：新增後 `status=draft`；更新後舊版本存入 `KnowledgeVersion`，`version += 1`；列表 API 支援分頁

- [ ] **T6-002** `ADMIN` **實作知識庫審核流程（draft → approved → archived）**
  - 說明：`POST /api/v1/admin/knowledge/:id/approve`（`draft → approved`；審核通過後 `findForRetrieval()` 可取得此條目）；`POST /api/v1/admin/knowledge/:id/archive`（`approved → archived`；封存後不再出現在 RAG 結果）；狀態轉換規則（`draft` 可 approve；`approved` 可 archive；`archived` 不可回退）；非法狀態轉換回傳 400
  - 輸出物：`src/admin/knowledge/knowledge-admin.service.ts`（更新）
  - 驗收：`approve` 後 `findForRetrieval()` 可取得；`archive` 後 RAG 不回傳；非法轉換有錯誤訊息

- [ ] **T6-003** `ADMIN` **實作 SystemConfig Admin API**
  - 說明：`GET /api/v1/admin/system-config`（列出所有 key-value）；`PATCH /api/v1/admin/system-config/:key`（更新 value → `SystemConfigService.invalidateCache()` → 寫入 AuditLog（含 before/after 值 snapshot））；更新 DTO 含 `class-validator` 驗證；`key` 不存在時回傳 404
  - 輸出物：`src/admin/system-config/system-config-admin.controller.ts`、`src/admin/system-config/dto/`
  - 驗收：更新後 cache 重新載入；AuditLog 有 before/after snapshot；runtime 即時生效（不需重啟）

- [ ] **T6-004** `ADMIN` **實作對話查詢 Admin API**
  - 說明：`GET /api/v1/admin/conversations`（支援 filter：`sessionId`、`dateFrom`、`dateTo`、`intentLabel`、`type`（normal/confidential）；支援分頁 `PaginationDto`（`page`、`limit`，`limit` 最大 100））；回傳含 `ConversationMessage` 摘要的列表
  - 輸出物：`src/admin/conversation/conversation-admin.controller.ts`、`src/admin/conversation/conversation-admin.service.ts`、`src/admin/conversation/dto/`
  - 驗收：filter 組合查詢正確；分頁回傳含 `total`、`page`、`limit`、`data`

- [ ] **T6-005** `ADMIN` **實作 AuditLog 查詢 Admin API**
  - 說明：`GET /api/v1/admin/audit-logs`（支援 filter：`requestId`、`sessionId`、`dateFrom`、`dateTo`、`eventType`；支援分頁）；`requestId` 精確查詢回傳單筆；所有回傳含 token 欄位
  - 輸出物：`src/admin/audit/audit-admin.controller.ts`、`src/admin/audit/audit-admin.service.ts`、`src/admin/audit/dto/`
  - 驗收：可依 `requestId` 查詢單筆；日期範圍 + 事件類型 filter 正確作用

- [ ] **T6-006** `ADMIN` **實作 Lead 查詢與狀態更新 Admin API**
  - 說明：`GET /api/v1/admin/leads`（支援 filter：`notificationStatus`、`type`、`dateFrom`、`dateTo`；分頁）；`PATCH /api/v1/admin/leads/:id/status`（更新 Lead 狀態，如 `contacted`、`closed`）；`GET /api/v1/admin/leads/:id/notifications`（查詢該 Lead 的推送記錄 `NotificationDelivery`）
  - 輸出物：`src/admin/lead/lead-admin.controller.ts`、`src/admin/lead/lead-admin.service.ts`、`src/admin/lead/dto/`
  - 驗收：列表 filter 正確；狀態更新成功；推送記錄查詢回傳 `NotificationDelivery` 列表

- [ ] **T6-007** `CORE` **建立 DashboardModule 與 DashboardService**
  - 說明：`DashboardService.getStats(startDate: Date, endDate: Date): Promise<DashboardStats>`；聚合查詢來源：`AuditLog`（eventType 分組統計）+ `Conversation`（總對話數、語言分布）+ `Lead`（留資量）+ `Ticket`（Ticket 狀態分布）+ `Feedback`（up/down 統計）；回傳欄位：`totalConversations`、`totalMessages`、`totalLeads`、`handoffCount`、`fallbackRate`（fallback事件數/總訊息數）、`avgRagConfidence`（AuditLog ragConfidence 平均）、`feedbackSummary`（`{ totalCount, upCount, downCount, upRate }`）、`ticketStatusSummary`（`{ open, in_progress, resolved, closed }`）、`topIntents`（top 5 intent + count）、`guardBlockCount`（PromptGuard 攔截次數）、`confidentialRefuseCount`（機密拒答次數）；日期範圍必填；查詢採單次多表 aggregation，不使用 N+1
  - 輸出物：`src/dashboard/dashboard.module.ts`、`src/dashboard/dashboard.service.ts`、`src/dashboard/types/dashboard-stats.type.ts`
  - 驗收：`getStats()` 回傳所有欄位；日期範圍 filter 正確套用；無 N+1 查詢

- [ ] **T6-008** `ADMIN` **實作 Dashboard Admin API**
  - 說明：`GET /api/v1/admin/dashboard?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`；`startDate`、`endDate` 為必填 query param（ISO 8601 格式）；缺少或格式錯誤時回傳 400；呼叫 `DashboardService.getStats()`；回傳完整 `DashboardStats` 物件
  - 輸出物：`src/dashboard/dashboard.controller.ts`、`src/dashboard/dto/dashboard-query.dto.ts`
  - 驗收：`GET /api/v1/admin/dashboard?startDate=...&endDate=...` 回傳 200 + 完整 stats；缺少日期參數 400；日期格式錯誤 400

- [ ] **T6-009** `OPS` **文件化後台 API 部署保護設定**
  - 說明：撰寫說明文件（`docs/admin-api-protection.md` 或 README 章節），明確說明：所有 `/api/v1/admin/**` 路由需在反向代理層設定 IP 白名單；本地開發環境或完全封閉環境例外；任何可被外部存取的環境部署前必須完成設定；說明範例 nginx 設定或 ingress 設定方式（OQ-006 保守預設）
  - 輸出物：`docs/admin-api-protection.md`（或 `README.md` 更新）
  - 驗收：文件存在且說明清晰；包含「此為部署前提，不是選項」的說明

- [ ] **T6-010** `TEST` **Phase 6 測試：知識庫版本管理整合測試**
  - 說明：整合測試：新增 → 審核 → `findForRetrieval()` 可取得；更新 → `KnowledgeVersion` 有舊版本記錄，`version += 1`，`status=draft`；封存 → `findForRetrieval()` 不回傳；非法狀態轉換回傳 400
  - 輸出物：`test/knowledge-admin.integration-spec.ts`
  - 驗收：版本管理與審核流程整合測試通過

- [ ] **T6-011** `TEST` **Phase 6 測試：Dashboard API 測試 + 查詢 API E2E 測試**
  - 說明：`DashboardService` 單元測試（mock DB）：`getStats()` 回傳所有欄位（含 `feedbackSummary: {totalCount, upCount, downCount, upRate}`）；日期範圍 filter 正確；E2E 測試（supertest）：`GET /api/v1/admin/dashboard` 含日期參數回傳 200；缺少日期 400；`GET /api/v1/admin/conversations` filter 組合查詢；`GET /api/v1/admin/audit-logs?requestId=xxx` 單筆查詢；`GET /api/v1/admin/leads` 分頁查詢；SystemConfig 更新 API AuditLog 記錄 before/after；`GET /api/v1/admin/tickets` filter + 分頁；`GET /api/v1/admin/feedback` filter + 分頁
  - 輸出物：`src/dashboard/dashboard.service.spec.ts`、`test/admin-query.e2e-spec.ts`（更新）
  - 驗收：Dashboard 與所有查詢 API E2E 測試通過；filter 與分頁行為正確

---

## Phase 7：品質補強與驗收準備

> **目標**：補齊所有 AC-001 ~ AC-019 測試覆蓋；效能驗證；完整操作說明  
> **里程碑**：M7 — 驗收就緒  
> **前置依賴**：Phase 2 ~ Phase 6 全部完成

---

- [ ] **T7-001** `TEST` **AC-001 ~ AC-019 對應測試逐條確認**
  - 說明：對照 `spec.md §12` 驗收條件，逐條確認每個 AC 有對應測試並記錄覆蓋情況；整理對照表（AC 編號 → 對應 test 檔案 + 測試案例名稱 → 狀態）；若甲方資料待補充（如 AC-003 機密 50 題）則標記保守預設已通過，等待完整資料
  - 輸出物：`docs/ac-coverage.md`（AC 覆蓋對照表）
  - 驗收：19 條 AC 均有記錄；無對應測試的 AC 需有說明（待甲方 or 已標記 Deferred）

- [ ] **T7-002** `TEST` **機密題庫完整測試集（50 題目標）**
  - 說明：擴充 Phase 3 的 10 題機密樣本（T3-009）至甲方提供完整清單（目標 50 題）；若甲方清單未到，以目前 10 題為基準通過 100% 驗收，記錄「保守預設通過」；執行並記錄測試結果
  - 輸出物：`test/fixtures/confidential-samples.fixtures.ts`（擴充版）、測試結果記錄
  - 驗收：現有樣本 100% 攔截；測試結果記錄存在；甲方補充後可直接擴充再跑

- [ ] **T7-003** `TEST` **Prompt Injection 完整測試集（≥ 30 題）**
  - 說明：擴充 Phase 3 的 10 種攻擊（T3-008）至 ≥ 30 題（含 10 種以上攻擊模式）；執行並記錄攔截率（需 ≥ 95%）
  - 輸出物：`test/fixtures/prompt-injection.fixtures.ts`（擴充版）、測試結果記錄
  - 驗收：≥ 30 題執行完成；攔截率 ≥ 95% 且記錄留存

- [ ] **T7-004** `TEST` **雙語測試集（中英各 25 題，共 50 題）**
  - 說明：建立雙語測試集（中文 25 題、英文 25 題，涵蓋 FAQ、產品詢問、拒答情境）；驗證：語言偵測正確率 ≥ 95%（`franc` 套件）；回覆語言與輸入語言一致；中文輸入得中文回覆，英文輸入得英文回覆
  - 輸出物：`test/fixtures/bilingual-test-cases.fixtures.ts`、`test/bilingual.spec.ts`
  - 驗收：50 題執行完成；語言正確率 ≥ 95% 且記錄留存

- [ ] **T7-005** `TEST` **P90 latency 驗證準備（效能測試腳本）**
  - 說明：建立效能測試腳本（使用 `artillery` 或 `k6`，或 Jest 並發測試腳本）；50 concurrent sessions；測試目標：首次回應 ≤ 3s（P90）、一般回答 ≤ 5s（P90）、fallback 回覆 ≤ 2s（P90）；記錄測試結果（壓測在暫存環境執行，不在 CI 每次跑）
  - 輸出物：`test/performance/load-test.yml`（artillery script）或等效腳本、測試結果記錄
  - 驗收：測試腳本可執行；結果記錄存在；三個 P90 目標各有測量值

- [ ] **T7-006** `TEST` **Fallback / Failure Path 補強測試**
  - 說明：依 `design.md §12.1 Failure Path 矩陣`，確認所有 failure path 均有測試覆蓋；重點補強：DB 連線中斷時 Health 回傳 503；LLM 連續失敗後 degraded 啟動；Webhook 3 次失敗後 `status=failed`；RAG 無結果時回傳 fallback 回覆；Pipeline 各步驟例外不洩露 stack trace
  - 輸出物：`test/failure-paths.spec.ts`（或補充至各模組 spec）
  - 驗收：所有 failure path 有測試案例；stack trace 不洩露確認

- [ ] **T7-007** `DATA` **確認 Retention / Soft Delete / Archive 欄位與機制**
  - 說明：確認以下欄位存在且正確：`Conversation.deletedAt`、`Lead.deletedAt`、`AuditLog.archivedAt`（AuditLog 不軟刪除，`archivedAt` 為歸檔標記）；建立 Cron Job 骨架（`RetentionWorker`）或說明文件，說明 1 年後 soft delete 的觸發機制（OQ-008 保守預設：1 年，正式部署前由甲方確認）；`archived` 資料不自動刪除
  - 輸出物：`prisma/schema.prisma`（欄位確認）、`src/common/workers/retention.worker.ts`（骨架）
  - 驗收：3 個 retention 欄位存在；Cron Job 骨架或文件說明 1 年保留規則

- [ ] **T7-008** `INTG` **確認所有 LLM 呼叫路徑 AuditLog token 欄位完整**
  - 說明：逐一確認所有觸發 LLM 呼叫的路徑（聊天主流程 LLM 生成、問診推薦摘要生成、對話摘要生成（SummaryService））各自的 AuditLog 記錄均有非 null 的 `promptTokens`、`completionTokens`、`totalTokens`、`durationMs`、`aiModel`、`aiProvider`
  - 輸出物：`docs/ac-coverage.md`（更新 LLM observability 欄位確認記錄）
  - 驗收：所有 LLM 呼叫路徑的 AuditLog token 欄位均非 null；有測試案例覆蓋

- [ ] **T7-009** `OPS` **`.env.example` 最終確認與完整化**
  - 說明：對照 `plan.md §14A` 環境變數清單，確認 `.env.example` 含所有變數佔位符；Email 相關變數預留但標記「本期不啟用」；HMAC `WEBHOOK_SECRET` 預留但標記「可選」；所有必填變數有說明注解
  - 輸出物：`.env.example`（最終版）
  - 驗收：所有 Phase 0~7 所需環境變數均有佔位符；Email / HMAC 預留有標記

- [ ] **T7-010** `OPS` **撰寫操作說明文件**
  - 說明：撰寫 `docs/operations.md`，包含：Migration 執行方式（`npx prisma migrate deploy`）；Seed 執行方式（含 NODE_ENV 說明）；Admin API 使用說明（各端點用途 + 保護設定提醒）；Webhook 接收端設定說明（payload 格式、重試機制說明）；SystemConfig 業務閾値說明（可調整項目與預設値）；LLM provider 資料政策確認步驟（本期為 OpenAI，需確認已關閉訓練資料使用選項）
  - 輸出物：`docs/operations.md`
  - 驗收：文件存在且涵蓋上述所有章節；可作為交付清單使用

- [ ] **T7-011** `OPS` **LLM provider 資料政策確認**
  - 說明：確認所選 LLM provider（本期預設 OpenAI）組織設定中已關閉「使用 API 資料訓練模型」的選項；在 `docs/operations.md` 中記錄確認步驟與截圖或確認說明
  - 輸出物：`docs/operations.md`（更新，含確認步驟）
  - 驗收：LLM provider 資料政策確認記錄存在於操作文件中

- [ ] **T7-012** `TEST` **最終整合驗收：AC-001 ~ AC-019 全跑一遍**
  - 說明：依 `docs/ac-coverage.md` 對照表，執行所有有對應測試的 AC；確認所有測試通過；保守預設完成的 AC 標記說明（如「機密 10 題保守預設通過，甲方補充後補跑」）；整理最終驗收記錄
  - 輸出物：`docs/acceptance-test-results.md`（驗收測試結果記錄）
  - 驗收：所有 AC 有通過記錄或保守預設說明；無未說明的空白項

---

## 5. 關鍵驗收任務

以下任務為本期最重要的驗收節點，**必須全部通過**方可宣告本期完成：

| 任務 | 驗收標準 | 對應 AC |
|------|---------|---------|
| T2-011 ~ T2-013 | Chat Pipeline 全步驟測試通過；SSE 事件格式正確；AuditLog token 欄位非 null | AC-001, AC-009 |
| T2-016 | SSE 串流、sessionToken 對映、Widget Config API 測試通過 | AC-001 |
| T3-008 | Prompt Injection ≥ 10 種攻擊，攔截率 ≥ 95% | AC-004 |
| T3-009 | 機密樣本 ≥ 10 題，100% 攔截，拒答無線索 | AC-003 |
| T4-008 | 問診四欄位順序測試通過 | AC-018 |
| T5-014 | Lead + Ticket 同步建立（handoff 閉環）；交接欄位正確 | AC-005, AC-006 |
| T5-015 | Feedback 評分 API 測試通過 | AC-019（擴充） |
| T5-007 ~ T5-009 | Lead 建立 + Webhook payload 完整 + Cron Worker 重試 | AC-005, AC-006 |
| T6-010 | 知識庫審核流程：draft → approved → RAG 可用 → archive → RAG 不回傳 | AC-016 |
| T6-011 | Dashboard API 回傳正確聚合統計；查詢 API E2E 測試通過 | AC-020（擴充） |
| T7-003 | ≥ 30 題 Injection 攔截率 ≥ 95%（記錄留存）| AC-004 |
| T7-002 | 機密題庫 100% 攔截（10 題保守預設或 50 題完整版）| AC-003 |
| T7-005 | P90 latency 壓測記錄：首次 ≤ 3s / 一般 ≤ 5s / fallback ≤ 2s | AC-009, AC-010, AC-011 |
| T7-012 | AC-001 ~ AC-019 逐條確認記錄 | 全部 AC |

---

## 6. 測試任務清單

以下為所有測試任務的快速索引：

### Phase 0 測試
- T0-013：GlobalExceptionFilter 單元測試 + Health E2E

### Phase 1 測試
- T1-011：SafetyService / IntentService / KnowledgeRepository 單元測試
- T1-012：Seed 整合測試（NODE_ENV 條件分支）

### Phase 2 測試
- T2-011：ChatPipeline 各步驟單元測試
- T2-012：RetrievalService 信心分數與閾值單元測試
- T2-013：AuditLog 整合測試 + LLM fallback 測試
- T2-016：SSE 串流、sessionToken、Widget Config 測試（新增）

### Phase 3 測試
- T3-007：SafetyService 攔截分類單元測試
- T3-008：Prompt Injection 測試集（≥ 10 種，Phase 7 擴至 30 題）
- T3-009：機密題庫樣本測試集（≥ 10 題，Phase 7 擴至 50 題）

### Phase 4 測試
- T4-008：DiagnosisService 問診流程單元測試
- T4-009：高意向偵測整合測試 + 摘要 fallback 測試

### Phase 5 測試
- T5-007：LeadService 整合測試
- T5-008：Cron Worker 重試邏輯 + 並發安全測試
- T5-009：Webhook Payload 欄位完整性測試
- T5-014：LeadService + TicketService 整合測試（含 handoff 閉環）（新增）
- T5-015：Feedback API 測試（新增）

### Phase 6 測試
- T6-010：知識庫版本管理整合測試
- T6-011：Dashboard API 測試 + 查詢 API E2E 測試（新增）

### Phase 7 測試（驗收層）
- T7-001：AC-001 ~ AC-019 對應測試逐條確認
- T7-002：機密題庫完整測試集（50 題目標）
- T7-003：Prompt Injection 完整測試集（≥ 30 題）
- T7-004：雙語測試集（中英各 25 題）
- T7-005：P90 latency 驗證
- T7-006：Fallback / Failure Path 補強測試
- T7-012：最終整合驗收

---

## 7. Deferred / 不納入本期的任務

以下任務**明確不納入本期**，保留擴充點說明：

| 任務佔位 | 說明 | 預留擴充點 |
|---------|------|-----------|
| **Auth / Login / RBAC** | 後台管理者登入驗證、角色權限控管 | Admin API 已按 `/api/v1/admin/` prefix 分組，後續接入 `@UseGuards(JwtAuthGuard)` |
| **Email 通知** | Lead 建立後 Email 通知業務 / 客服 | `IEmailProvider` 介面已宣告；`.env.example` 預留 `EMAIL_PROVIDER`、`EMAIL_API_KEY`、`LEAD_NOTIFY_EMAIL` |
| **end session API** | 由前端主動結束 session 的端點 | 本期不做；前端以 `AbortController.abort()` / connection close 為正式機制；如有需求後續評估 |
| **handoff status 查詢 API** | 前端輪詢 Ticket / Lead 處理進度的 API | `Ticket` 實體已建立；介面設計待甲方確認查詢頻率與格式後實作 |
| **向量語意檢索 / pgvector** | pgvector / Pinecone 等語意搜尋升級 | `IRetrievalService` 介面隔離，升級不影響 Application Layer |
| **自動封鎖敏感用戶** | 累積敏感意圖自動觸發封鎖 | `Conversation.sensitiveIntentCount` 已記錄；封鎖規則待甲方確認後實作 |
| **ML 意圖分類** | 機器學習模型替換 rule-based | `IIntentService` 介面隔離，替換不影響 Pipeline |
| **Redis / Bull Queue** | 高吞吐通知架構 | `NotificationJob` Outbox 表相容；`INotificationQueue` 介面可切換實作 |
| **多租戶架構** | 多客戶 / 品牌租戶隔離 | 所有表可加 `tenant_id` 欄位 |
| **自動化報表匯出（FR-077）** | 資料匯出 CSV / Excel | FR-077（P2 優先級），AuditLog + Dashboard 已有足夠資料 |
| **HMAC Webhook 簽名（強制）** | Webhook 請求驗證簽名 | `WEBHOOK_SECRET` 環境變數預留；`WebhookProvider` 架構支援 |

---

## 8. Open Questions / Assumptions 對應說明

以下 OQ 在任務中均採保守預設值執行，不讓任務懸空：

| OQ | 問題 | 任務中採用的保守預設 | 影響任務 |
|----|------|-------------------|---------|
| **OQ-001** | `pg_trgm` 在目標部署環境是否可用？ | 假設可用；ILIKE fallback 在 T2-005 實作，可透過 `PG_TRGM_ENABLED` env 切換 | T0-012、T2-005 |
| **OQ-002** | 機密關鍵字清單何時由甲方提供？ | T1-003 seed 先用保守預設關鍵字（≥ 10 筆）；T3-009 以 10 題樣本通過 100% 驗收；甲方補充後 T7-002 重跑 50 題 | T1-003、T3-009、T7-002 |
| **OQ-003** | 問診模板追問語句由甲方確認的時間點？ | T1-004 先用通用追問文字（如「請問您的使用用途是？」）；甲方確認後透過後台 API 更新 DB，不需改程式 | T1-004、T4-002 |
| **OQ-004** | Webhook 接收端系統與欄位確認時間？ | T5-004 使用本地 mock HTTP server 開發與測試；FR-063 payload 已定義，甲方調整只需修改 `buildPayload()` | T5-004、T5-005 |
| **OQ-005** | HMAC Webhook 簽名是否啟用？ | 本期不強制；T5-005 中 `WEBHOOK_SECRET` 環境變數預留在 `.env.example`；架構支援後續啟用 | T5-005、T7-009 |
| **OQ-006** | 後台 API IP 白名單 / 反向代理由誰設定？ | T6-009 撰寫部署保護文件；任何外部可存取環境部署前必須完成反向代理 + IP 白名單設定；此為部署前提，不是選項 | T6-009、T7-010 |
| **OQ-007** | `sensitive_intent_alert_threshold` 設幾次？ | T3-003 SystemConfig 預設值 `3`；可在 T6-003 SystemConfig Admin API 調整，不需重啟 | T3-003、T6-003 |
| **OQ-008** | 資料保存 1 年是否符合甲方 / 法務要求？ | T7-007 Cron Job 骨架建立 + 1 年保留說明文件；正式部署前由甲方確認，確認後調整 SystemConfig 即可 | T7-007、T7-009 |
| **OQ-009** | SSE 事件格式是否與前端 Widget 已對齊？ | 保守預設：依 design.md §8.3-§8.4 格式實作（token chunk + event:done/error/timeout/interrupted）；T2-016 測試後與前端同步確認 | T2-007、T2-008、T2-016 |
| **OQ-010** | sessionToken 是否需持久化至 localStorage / Cookie？ | 後端不介入前端持久化機制；後端只驗證 sessionToken 存在且 Conversation 未刪除；前端自行決定存儲策略 | T2-002、T2-008 |

---

## 9. 最終完成條件摘要

### 9.1 所有任務全部完成後代表本期執行完成

- [ ] Phase 0 ~ Phase 7 所有 `[ ]` 任務均已勾選
- [ ] `npm run test` 所有單元測試通過
- [ ] `npm run test:e2e` 所有 E2E 測試通過
- [ ] `docs/acceptance-test-results.md` 存在且 AC-001 ~ AC-019 逐條有記錄

### 9.2 可因甲方資料未補齊而以保守預設完成的任務

| 任務 | 保守預設完成標準 | 甲方補充後動作 |
|------|----------------|--------------|
| T1-003（機密關鍵字 seed） | ≥ 10 筆保守預設關鍵字 | 透過 Admin API（T3-006）動態補充，無需重新 migrate |
| T1-004（問診模板文字） | 通用追問文字佔位 | 透過 Admin API（IntentTemplate 更新）替換，無需改程式 |
| T3-009（機密樣本測試） | 10 題樣本 100% 通過 | 擴充 T7-002 fixtures 至 50 題重跑 |
| T7-002（機密完整測試） | 10 題保守預設通過，記錄說明 | 甲方補充清單後擴充 fixtures 並執行 |

### 9.3 本期最重要的驗收測試依據

以下測試結果為交付驗收的核心證據，**必須有執行記錄**：

1. **安全防護**（最高優先）
   - Prompt Injection 攔截率 ≥ 95%（≥ 30 題，記錄留存）→ T7-003
   - 機密題庫 100% 攔截（10 題保守預設或 50 題完整版）→ T7-002

2. **效能**
   - P90 latency：首次 ≤ 3s / 一般 ≤ 5s / fallback ≤ 2s（50 concurrent sessions 壓測記錄）→ T7-005

3. **功能主流程**
   - Chat Pipeline 全步驟測試通過（含 PromptGuard 接入非空 stub、SSE 串流正確）→ T2-011、T2-016
   - AuditLog 所有 LLM 呼叫路徑 token 欄位非 null → T7-008
   - Lead 建立 + Ticket 同步建立 + Webhook 推送 + Cron Worker 重試 → T5-014、T5-007 ~ T5-009
   - Feedback 評分 API 測試通過 → T5-015
   - Dashboard 聚合查詢測試通過 → T6-011
   - 問診四欄位流程測試通過 → T4-008

4. **驗收條件全覆蓋**
   - AC-001 ~ AC-019 逐條對照記錄 → T7-001、T7-012

---

## 修訂記錄

| 版本 | 日期 | 修訂摘要 |
|------|------|---------|
| 1.0.0 | 2026-04-10 | 初版建立，承接 plan.md v1.0.0；涵蓋 Phase 0~7 共 66 個任務，含 OQ 保守預設對應、Deferred 清單、驗收條件摘要 |
| 1.1.0 | 2026-04-10 | 承接 spec.md v1.4.0 / design.md v1.6.0 / plan.md v1.1.0；同步 10 項拍板結果：(1) 新增 §0 本期實作總原則；(2) Phase 2 改為 SSE 串流主流程，T2-007/T2-008 全面重寫；(3) sessionToken 取代 sessionId 於所有前端 API 路徑；(4) T2-001 Conversation migration 加入 session_token 欄位；(5) T2-002 加入 findBySessionToken()；(6) T2-004 ILlmProvider 加入 stream() 方法；(7) T2-009 AiStatusService 聯動 Widget Config degraded_status；(8) 新增 T2-014/T2-015/T2-016（Widget Config migration/seed、WidgetConfigModule、SSE+sessionToken+Widget Config 測試）；(9) Phase 5 改名為 Lead/Webhook/Ticket/Feedback 閉環；(10) T5-001 加入 Ticket + Feedback migration；(11) T5-002/T5-003 handoff 同步建立 Ticket，API 路徑改用 sessionToken；(12) 新增 T5-010~T5-015（TicketModule、Ticket Admin API、FeedbackModule、Feedback API、整合測試）；(13) Phase 6 改名加入 Dashboard；(14) 重新編號 T6-007/T6-008（DashboardModule、Dashboard Admin API）；(15) T6-009 改為部署文件（原 T6-007），T6-010/T6-011 為測試；(16) §7 Deferred 移除 Streaming/Ticket/Dashboard/Feedback/Ticket實體化/FR-076，新增 handoff status API；(17) §8 新增 OQ-009/010/011；(18) §9 驗收條件補充 SSE/Ticket/Feedback/Dashboard 項目 |
| 1.2.0 | 2026-04-13 | 最後一輪 API contract 對齊修訂（承接 spec.md v1.5.0 + design.md v1.7.0）：①§0 補入 fetch+ReadableStream、AbortController 取消機制、SSE 事件格式最終版、value:up/down、Lead 欄位最終版；②T5-001 Lead model（name/email 必填，company/phone/message 選填）+ Feedback model（value:up/down，移除 rating）；③T5-003 CreateLeadDto 欄位修正；④T5-005 Webhook payload 欄位映射修正；⑤T5-012/T5-013 FeedbackService/API 改為 value:up/down，Admin filter 移除 rating；⑥T5-015 Feedback 測試改為 value enum 驗證；⑦T6-007 Dashboard feedbackSummary 改為 {totalCount,upCount,downCount,upRate}；⑧T6-011 Dashboard 測試補入 feedbackSummary 正確格式驗證；⑨OQ-011 status 改為 online/offline/degraded（移除 inactive） |
| 1.3.0 | 2026-04-14 | 依 spec.md v1.6.0 同步對齊（承接 spec.md v1.6.0 + design.md v1.8.0 + plan.md v1.3.0）：①承接文件版本更新；②§0 Lead API 欄位補入 `language`（選填）、補入「end session API 本期不做」原則、Handoff API response leadId/ticketId 為 nullable；③T5-001 Lead migration 新增 `language` 欄位（選填）；④T5-003 CreateLeadDto 新增 `language?: string`；⑤T5-005 Webhook payload 新增 `message`、`language`、`summary` 欄位說明（均為選填，可為 null）；⑥T5-009 Webhook 測試補入新欄位驗收；⑦§7 Deferred 新增 end session API 條目 |
| 1.3.1 | 2026-04-14 | 最後一輪一致性小幅修補（承接 plan.md v1.3.1）：①handoff response contract 統一——§0 / T2-008 / T2-016 / T5-014 補充 nullable 語意（action="handoff" 穩定語意，accepted=true 時 leadId / ticketId 不得同時為 null）；②`/lead` API 成功時 leadId 不可為 null（T5-003 說明與驗收更新）；③`GET /api/v1/health/ai-status` 明確標示為 internal health / monitoring endpoint（§0 + T0-010），非前端 Widget 正式初始化依賴 |
| 1.4.0 | 2026-04-16 | LLM provider 抽象化修訂（承接 spec.md v1.7.0 + design.md v1.9.0 + plan.md v1.4.0）：①T0-002 `.env.example`：`OPENAI_API_KEY` 拆為 `LLM_PROVIDER`+`LLM_API_KEY`+`LLM_BASE_URL`；②Phase 2 前置依賴：`OpenAI API Key 已取得` → `LLM provider API key 已取得（本期預設 OpenAI，使用 LLM_API_KEY）`；③T2-004 全面更新：加入本期預設模型策略、雙層 fallback、`ClaudeProvider` 可擴充備註、fallbackTriggered AuditLog；④T2-006 驗收：`符合 OpenAI API 規格` → `符合 LLM provider API 規格（本期 OpenAI）`；⑤T7-010 ops doc 加入 LLM provider 資料政策確認步驟；⑥T7-011 改名為 LLM provider 資料政策確認，說明/驗收 provider-neutral |

**版本**：1.4.0 | **建立日期**：2026-04-10 | **狀態**：Draft
