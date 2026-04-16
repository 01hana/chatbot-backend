# 震南官網 AI 客服聊天機器人（Backend Constitution）

**版本**：1.2.0 | **Ratified**：2026-04-08 | **Last Amended**：2026-04-16

---

## 1. 文件目的

本文件為「震南官網 AI 客服聊天機器人後端系統」的開發憲章（Constitution），作為所有 `spec.md`、`design.md`、`plan.md`、`task.md` 與程式實作的最高約束依據。

本憲章只規範後端系統的開發行為，不涉及前端 UI、畫面設計、元件切分或樣式規範。任何與本憲章衝突的下層文件，以本憲章為準。

---

## 2. 專案使命（Mission）

在震南企業官網導入 AI 智能客服後端，支援 24/7 對外服務，提供：
- 公開資訊問答
- 問診式產品推薦與規格摘要
- 詢價前置收斂
- Lead 收集與留資閉環
- 涉及機密或深度技術問題時：明確拒答並轉人工

核心使命原則：**讓 AI 只做它能做好、且被授權做的事；其餘的交給人。**

---

## 3. 核心原則（Core Principles）

下列原則為**必須遵守**，任何 spec / design / task 不可違反：

| # | 原則 | 說明 |
|---|------|------|
| C1 | 安全優先 | 機密保護 > 功能完整性 > 使用體驗；寧可拒答，不可洩漏 |
| C2 | 可稽核優先 | 每個關鍵決策必須可追溯；無法追溯的決策視為不完整交付 |
| C3 | 可靠性優先 | AI 不可用時系統主流程不可失效；fallback 是一等公民，不是補丁 |
| C4 | 知識分級 | public / internal / confidential 三級不可混用；對外只能使用 public 分級內容 |
| C5 | 不猜測 | 不確定就追問，不可臆測作答，不可讓模型自行填補資訊缺口 |
| C6 | 單人可執行 | 任何設計決策必須在單人開發規模下可落地；不做過度複雜的抽象 |

---

## 4. 產品邏輯原則（Product Logic Principles）

**必須遵守：**

- **不確定就追問**：若對話中的需求資訊不足以產生有信心的回覆，後端應返回「追問意圖」而非觸發生成。
- **遇機密就拒答**：當意圖識別或知識分級判斷涉及 confidential 或 internal 分級時，必須返回拒答訊號並觸發轉人工流程，不得嘗試模糊作答。
- **低信心不生成**：RAG 檢索信心度低於設定閾值（預設 0.7，可由環境變數設定）時，不得觸發 LLM 生成內容；應返回「無法確認」狀態或追問。
- **回覆必須可追溯**：所有對外回覆必須記錄所引用的知識條目 ID、版本號與段落來源；不可只存最終答案。
- **對外答案以核准公開知識優先**：LLM 生成內容必須建立在 RAG 檢索結果之上；不得純粹依賴模型參數知識對外回答產品相關問題。
- **問診式推薦優先於直接下結論**：產品推薦流程應先收斂使用者需求（問診），再提供推薦；不可跳過需求確認直接推薦。
- **留資與轉人工是主流程的一部分**：不是降級選項，是產品設計的正規出口；留資表單、通知 Webhook、Ticket 建立均為核心功能。

**建議遵守：**

- 在多輪對話中維護對話狀態，避免每輪重複詢問已知資訊。
- 意圖識別信心低時，優先使用選項式澄清，而非開放式追問。
- 對高意向訪客（多輪詢問、詢價行為）主動推動留資流程。

---

## 5. AI / RAG 安全原則

**必須遵守：**

- **禁止 Prompt Injection**：所有使用者輸入在進入 prompt 之前，必須通過後端的 Prompt Guard 服務進行顯式判斷；不可只靠 prompt 中的文字指令防禦。
- **禁止越獄與規則覆寫**：Prompt Guard 必須偵測並攔截：試圖覆寫 system prompt、要求揭露 system prompt 內容、要求扮演無限制角色、blacklist 關鍵字比對等攻擊模式。
- **禁止揭露 System Prompt**：不得在任何回覆或日誌中揭露完整 system prompt；若使用者索取，必須明確拒絕。
- **資料不可用於外部訓練**：甲方知識庫、對話資料、客戶資料不得作為外部模型再訓練素材；必須確認所選 LLM provider 的資料使用政策符合甲方要求，並明確關閉任何允許 provider 使用甲方資料進行訓練的選項。
- **知識分級強制執行**：知識條目寫入資料庫時必須帶有 `visibility` 欄位（`public` / `internal` / `confidential`）；送入 LLM 的 context 只能包含 `public` 分級條目。
- **信心閾值為硬性門檻**：RAG 信心分數低於閾值時，後端必須短路（short-circuit），不得繼續組裝 prompt 送往 LLM。

**建議遵守：**

- 為 Prompt Guard 建立可設定的 blacklist 與 pattern list，支援後台動態調整。
- RAG 檢索時記錄 top-k 結果與信心分數，存入稽核資料供事後分析。
- 定期以機密題庫（confidential test set）執行回歸測試，驗證機密防護未退化。

---

## 6. 後端架構原則（Backend Architecture Principles）

**必須遵守：**

- **三層分離**：Module → Controller → Service；Controller 只做 request 驗證與路由回應，業務邏輯全在 Service 層。
- **業務規則集中**：機密判斷、信心閾值判斷、意圖路由、留資觸發等業務規則必須在 Service / Domain 層明確實作，不可散落於 controller route handler 或 middleware。
- **安全攔截優先於生成**：Prompt Guard 與知識分級判斷必須在 LLM 呼叫之前執行，不可交由 LLM 自行判斷是否回答。
- **AI Provider 可替換**：LLM 呼叫必須通過抽象介面（`ILlmProvider`），底層可替換為不同 provider（本期預設 `OpenAiProvider`，未來可擴充 `ClaudeProvider`）；不可在業務邏輯層直接呼叫任何特定 provider SDK。
- **檢索策略可替換**：RAG 檢索層必須通過抽象介面（`KnowledgeRetrieverPort`），MVP 階段可用 SQL full-text search，後續可替換為向量檢索，不影響上層邏輯。
- **知識分級不可混用**：`public`、`internal`、`confidential` 三個分級的資料存取路徑必須在程式碼層面物理隔離，不可靠 if/else 臨時判斷。
- **所有高風險決策可追溯**：意圖判斷結果、機密觸發、RAG 短路、留資觸發、轉人工觸發，均需在稽核日誌中記錄決策依據與時間戳。
- **不強依賴 Auth / RBAC**：本期架構不以 Auth / RBAC 作為阻擋性依賴；API 端點的存取控制未來以 Guard 方式插入，不影響現有業務邏輯。

> 🔖 **未來擴充**：待 Auth 機制上線後，可在 Controller 層加入 `@UseGuards(JwtAuthGuard)` 與 RBAC Policy，無需重構 Service 層。

**建議遵守：**

- MVP 階段以單體 NestJS 模組為主；若未來需拆微服務，模組邊界已預留。
- 避免過早引入事件驅動架構；Webhook 通知以同步 HTTP 呼叫搭配 retry 即可。
- 採用 `class-validator` + DTO 嚴格驗證所有 request body，禁止 `any` 型別。

---

## 7. 資料治理原則（Data Governance）

**必須遵守：**

- **知識條目必須帶版本**：每筆知識條目需有版本號、建立時間、最後更新時間、審核狀態（`draft` / `approved` / `archived`）與 `visibility` 分級。
- **對外只能使用 approved + public 知識**：RAG 檢索必須在 query 層過濾，只取 `status = approved AND visibility = public` 的條目。
- **對話紀錄保留完整 metadata**：每輪對話需記錄：sessionId、turnId、requestId、timestamp、使用者輸入（脫敏後）、系統回覆、引用知識條目 ID 與版本、意圖標籤、信心分數、Prompt Guard 結果。
- **Lead 資料最小必要原則**：留資表單只收集完成通知與後續跟進所需的最少欄位（姓名、聯絡方式、需求摘要）；不得蒐集與當前需求無關的個人資料。
- **甲方資料隔離**：知識庫、對話記錄、Lead 資料必須存於甲方控制的資料庫（Postgres），不得將原始資料推送至外部服務（包含任何 LLM provider 的訓練用途）。
- **環境變數管理機密**：資料庫連線字串、LLM API Key（`LLM_API_KEY`）、Webhook Secret 等敏感設定全部透過環境變數注入；不可硬編碼在程式碼或設定檔中。

**建議遵守：**

- 為 Lead 資料定義保留期（建議 2 年後歸檔或刪除），並在 schema 中加入 `retentionPolicy` 欄位備查。
- 對話紀錄中的使用者輸入在落地前先執行 PII redaction（電話、Email、身份證字號等）。

---

## 8. 安全原則（Security Principles）

**必須遵守：**

- **Prompt Guard 為後端顯式流程**：不可把安全防護全部交給 system prompt 文字；必須有後端程式碼層面的顯式攔截判斷。
- **輸入驗證**：所有外部輸入（使用者訊息、查詢參數、Webhook payload）必須通過 DTO 與 `class-validator` 驗證，不接受未知欄位（`whitelist: true, forbidNonWhitelisted: true`）。
- **SQL Injection 防護**：所有資料庫操作必須使用 Prisma ORM 參數化查詢，不可拼接 raw SQL 字串。
- **API 速率限制**：聊天 API 必須設定速率限制（`@nestjs/throttler`），防止濫用與暴力攻擊。
- **敏感回應不可 log 明文**：LLM provider API 回應若含敏感資訊，log 時只記錄 hash；不得將完整 response 以明文寫入一般日誌。
- **HTTP 安全標頭**：透過 Helmet 設定 `X-Content-Type-Options`、`X-Frame-Options`、`Content-Security-Policy` 等安全標頭。

> 🔖 **未來擴充**：Auth 機制、JWT Guard、CSRF Token 視需求於後續階段加入。

**建議遵守：**

- 對外 API 回傳的錯誤訊息不可洩露 stack trace 或內部路徑；使用全域 Exception Filter 統一格式。
- LLM provider API 呼叫時傳入匿名化的 session hash，便於 provider 側濫用偵測；同時確認所使用 provider 的資料政策已符合甲方要求（不用於訓練）。

---

## 9. API 與模組設計原則

**必須遵守：**

- **統一回傳格式**：所有 API 回應通過 `TransformInterceptor` 包裝，格式為 `{ code, data, requestId, timestamp }`。
- **錯誤格式統一**：使用全域 `HttpExceptionFilter`，回傳 `{ code, message, requestId, timestamp }`；不可將 NestJS 預設錯誤格式直接暴露。
- **每個模組含 controller / service / module**：遵循 Feature-based modules；每個功能域（chat、knowledge、lead、audit）為獨立模組。
- **Constructor Injection**：所有 Service 依賴必須通過建構子注入，禁止 `new Service()` 直接實例化。
- **DTO 嚴格定義**：所有 request body / query 使用 `*.dto.ts`，並標注 `class-validator` 裝飾器；禁止 `any`。
- **Request ID 全鏈路**：每個請求在 middleware 層產生 `requestId`（UUID v4）並注入至 context，所有日誌與稽核記錄均帶此 ID。

**建議遵守：**

- 使用 `@nestjs/swagger` 為 API 加上文件標注，方便後續維護。
- 模組之間透過 Service 介面溝通，避免跨模組直接引用 Repository。

---

## 10. 知識庫與內容管理原則

**必須遵守：**

- **知識條目欄位最低規格**：id、title、content、visibility（`public` / `internal` / `confidential`）、status（`draft` / `approved` / `archived`）、version、createdAt、updatedAt、approvedAt、tags。
- **審核狀態控管**：只有 `status = approved` 的條目可被 RAG 檢索使用；draft 與 archived 條目不得進入任何對外回覆流程。
- **版本不可覆寫**：知識條目更新時建立新版本（version + 1），舊版本保留（`archived`）；對話引用的知識條目 ID + version 需一同記錄，確保事後可還原當時的回答依據。
- **知識可按意圖 / 標籤分組**：支援後台為條目設定 tags 與意圖對應，RAG 檢索時可依意圖縮小候選範圍，提高精準度。

**建議遵守：**

- MVP 階段以關鍵字 / full-text search（Postgres `tsvector`）實作 RAG 檢索，後續可升級為向量檢索。
- 提供後台 API 支援知識條目的 CRUD、狀態流轉與版本瀏覽；本期先以後端 API 為主，不強求後台 UI。

---

## 11. 後端與外部整合原則

**必須遵守：**

- **LLM Provider 呼叫透過 `ILlmProvider` 封裝**：業務邏輯不可直接呼叫任何特定 provider SDK；所有呼叫必須通過實作 `ILlmProvider` 介面的 provider（本期預設 `OpenAiProvider`，未來可擴充 `ClaudeProvider`），便於替換與測試。
- **超時與 Retry**：AI API 呼叫必須設定請求超時（建議 15s，可由環境變數設定）與 retry（最多 2 次，帶指數退避）。
- **Fallback 為強制要求**：AI 呼叫失敗（超時、5xx、rate limit）時，必須觸發 fallback 流程：返回預設回覆並記錄降級事件；不可讓系統拋出未處理錯誤。
- **Webhook 通知具備 retry**：Lead 通知、轉人工 Webhook 呼叫失敗時必須 retry（最多 3 次，指數退避）；失敗後需記錄失敗事件，不可靜默丟棄。
- **Email 通知解耦**：Email 發送通過 `NotificationService` 介面封裝，底層可替換（SMTP / SendGrid / Resend）；不可在業務邏輯中直接呼叫 mail transporter。

**建議遵守：**

- 對外整合的 API Key / Secret 統一由環境變數注入，不可出現在任何設定檔案或程式碼中。
- 記錄所有外部整合呼叫的 request / response（脫敏後）至稽核日誌，包含 HTTP 狀態碼與延遲時間。

---

## 12. 測試原則（Testing Principles）

**必須遵守：**

- **單元測試**：覆蓋 Service 層業務規則、Prompt Guard 邏輯、意圖分類、信心閾值判斷、知識分級過濾、Lead 觸發條件、DTO 驗證。
- **整合測試**：覆蓋聊天 API 完整請求流程、RAG 知識檢索、LLM Adapter（`ILlmProvider` mock）、留資流程、Webhook 呼叫、降級模式。
- **E2E / API 流程測試**：覆蓋聊天主流程（正常回覆、機密拒答、低信心追問）、完整留資流程、轉人工流程、AI 失效降級。
- **安全測試**：Prompt Injection 測試案例（至少 10 種攻擊模式）、機密題庫測試（confidential 問題不得被回答）、分級誤用測試（internal / confidential 知識不得出現在對外回覆）。
- **不可只測 happy path**：每個功能的測試必須包含失敗路徑（timeout、service unavailable、invalid input、低信心短路、機密攔截）。
- **測試使用 Jest**：單元測試與整合測試使用 Jest + NestJS testing utilities；E2E 使用 `@nestjs/testing` + supertest。

**建議遵守：**

- 為機密防護建立獨立的 `confidential.testset.ts`，定期執行確認防護未退化。
- 測試覆蓋率目標：Service 層 > 80%；安全相關路徑 100%。
- 每個 task 完成後必須確認對應測試通過，再進入下一個 task。

---

## 13. 可觀測性與稽核原則（Observability & Auditability）

**必須遵守：**

- **Request ID 全鏈路**：每個請求在入口 middleware 產生 UUID v4 `requestId`，注入至 NestJS `AsyncLocalStorage` context，所有 service log 與稽核記錄均帶此 ID。
- **稽核日誌最低欄位**：

  ```
  requestId       : string (UUID v4)
  timestamp       : ISO 8601
  sessionId       : string
  actor           : 'anonymous' | userId（若未來有 auth）
  endpoint        : string
  intent          : string
  ragConfidence   : number
  promptGuardResult : 'pass' | 'blocked'
  blockedReason   : string | null
  knowledgeRefs   : { id, version }[]
  aiProvider      : string
  aiModel         : string
  aiModelVersion  : string
  promptHash      : SHA256
  responseHash    : SHA256
  fallbackTriggered : boolean
  leadTriggered   : boolean
  humanHandoffTriggered : boolean
  durationMs      : number
  ```

- **稽核日誌 Append-Only**：寫入 `AuditLog` table 後不可更新或刪除；任何補充說明建立新記錄。
- **結構化日誌**：所有 `Logger` 輸出必須為 JSON 格式，包含 `requestId`、`level`、`service`、`message`、`timestamp`。
- **降級事件明確記錄**：每次 fallback 觸發必須在稽核日誌中標記 `fallbackTriggered: true` 並記錄原因（timeout / provider_error / low_confidence 等）。

**建議遵守：**

- 部署 `/health` endpoint（`@nestjs/terminus`），包含 DB 連線與 AI provider ping 健康檢查。
- 重要錯誤（AI 呼叫失敗、機密攔截、Webhook 失敗）推送至外部監控（Sentry 或等效服務）。

---

## 14. 效能與可靠性原則

**必須遵守：**

- **AI 呼叫超時設定**：LLM provider API 呼叫超時上限 15 秒（可透過 `LLM_TIMEOUT_MS` 環境變數調整）；超時必須觸發 fallback，不可無限等待。
- **Fallback 回應時間 < 2 秒**：AI 不可用時，fallback 回應（預設訊息 + 留資選項）需在 2 秒內返回。
- **資料庫查詢不可無上限**：所有列表查詢必須帶分頁（`limit` / `offset` 或 cursor-based）；禁止 `findAll()` 無條件全表掃描。
- **速率限制**：聊天 API 對同一 IP / sessionId 設定請求頻率上限（建議 30 req/min，可環境變數調整）。

**建議遵守：**

- 知識檢索使用資料庫索引（`tsvector` index 或 pg_vector），避免全表 LIKE 查詢。
- AI adapter 層實作簡單的 in-memory 快取（TTL 5 分鐘）針對高頻且結果穩定的意圖查詢。

---

## 15. 多語系原則

**必須遵守：**

- **語言偵測在後端執行**：使用者輸入的語言偵測必須在後端 Service 層執行（使用語言偵測 library 或 LLM 前處理），結果存入對話 context。
- **回覆語言與輸入語言一致**：System prompt 指示 LLM 以使用者輸入語言回覆；若偵測結果為繁體中文，回覆繁體中文；英文輸入回覆英文。
- **多語系不影響機密防護**：Prompt Guard 必須在語言偵測後、以正規化方式執行攔截，不可因語言切換繞過防護。

**建議遵守：**

- 支援繁體中文、英文為第一優先語系；日文、簡體中文為未來擴充。
- 語言偵測結果記錄至對話 context 與稽核日誌。

---

## 16. 開發流程原則（spec → design → plan → task → implement）

**必須遵守：**

- **流程不可跳步**：每個功能必須依序通過 spec → design → plan → task → implement；不可直接從需求跳到實作。
- **spec.md**：定義功能需求、使用情境、驗收條件、已知限制；需與本 constitution 條文對齊。
- **design.md**：定義模組邊界、資料模型、API 介面、流程圖；不可在 design 階段遺漏安全流程（Prompt Guard、知識分級、fallback）。
- **plan.md**：定義實作階段與 phase 切分；每個 phase 必須可獨立演示與驗證。
- **task.md**：細化為可執行的開發工作項；每個 task 必須包含驗收條件與對應測試描述。
- **implement**：依 task 實作，完成後需確認 DoD；不可因趕進度跳過測試或稽核要求。

**建議遵守：**

- spec / design 完成後先做一次 constitution alignment check，確認無違反原則的設計。
- plan 階段標記每個 phase 的 rollback 方式，確保可回退。

---

## 17. 單人開發執行原則

**必須遵守：**

- **MVP 優先**：每個 phase 只做能驗證核心假設的最小功能集；報表、進階分析、優化留到後期 phase。
- **流程邊界先行**：優先建立穩定的 domain model 與模組邊界；邊界錯了比功能少更難修復。
- **新增複雜度需有明確收益**：每一個抽象層、設計模式、第三方套件引入，必須說明解決的具體問題；不可因「之後可能會用」就引入。
- **每個 phase 可演示、可驗證、可回退**：phase 完成時必須能跑起來展示核心流程，且可以在不影響已完成 phase 的情況下回退。
- **避免過早插件化**：可以設計可替換介面，但不要一開始就實作 plugin registry；等到真的需要替換時再重構。

**建議遵守：**

- 以 GitHub Issues / Notion / 任意可追蹤工具記錄每個 task 的狀態；不可只靠記憶追蹤進度。
- 每週至少一次 self-review：確認目前實作是否仍符合 constitution；若有漂移，記錄並修正。

---

## 18. Definition of Done（DoD）

一個 task 完成的條件，以下**全部必須滿足**：

- [ ] 功能邏輯完成，且符合對應 spec.md 的驗收條件
- [ ] 有對應的單元測試，且測試通過
- [ ] 有對應的整合測試（若涉及跨模組或外部整合）
- [ ] 有完整的錯誤處理（HTTP Exception、外部呼叫失敗、fallback 路徑）
- [ ] 有結構化日誌記錄（含 requestId）
- [ ] 若涉及 AI 呼叫或留資流程，有對應稽核日誌記錄
- [ ] 若涉及外部整合，有 fallback / retry 機制
- [ ] 相關 spec / design / plan 文件已更新（若有變動）
- [ ] 不違反本 constitution 任何「必須遵守」原則
- [ ] 程式碼無 `any` 型別、無硬編碼機密、無未處理的 Promise rejection

---

## 19. Quality Gates

下列任一條件觸發即視為**不可合併 / 不可上線**：

- ❌ 存在硬編碼的 API Key、資料庫密碼或任何機密值
- ❌ Prompt Guard 邏輯只存在於 prompt 文字中，沒有後端顯式程式碼攔截
- ❌ RAG 信心閾值判斷缺失，任何信心分數都直接觸發 LLM 生成
- ❌ 對外回覆缺少知識來源引用（知識條目 ID + 版本）
- ❌ AI 呼叫無超時設定、無 fallback 處理
- ❌ 聊天 API 沒有速率限制
- ❌ 對外 API 回傳 stack trace 或內部路徑資訊
- ❌ 知識條目分級（public / internal / confidential）在程式碼中以 if/else 混用，未物理隔離
- ❌ 稽核日誌缺少 requestId 或 timestamp
- ❌ 測試只覆蓋 happy path，缺少失敗與安全測試案例
- ❌ 任何 Service 層邏輯直接寫在 Controller 中

---

## 20. Change Control / 規格變更原則

**必須遵守：**

- **Constitution 修訂需記錄**：任何修訂必須在本文件底部記錄：版本號、修訂日期、修訂人、變更摘要、受影響文件。
- **核心原則變更需說明影響**：修改 C1–C6 核心原則時，必須說明對現有 spec / design / plan 的影響，並提出遷移計畫。
- **spec 變更需同步評估 constitution 對齊**：任何 spec.md 變更若涉及安全、資料分級、稽核規格，必須先確認與本 constitution 不衝突。
- **不可因趕進度降低安全標準**：任何以「先上線再說」為由跳過 Prompt Guard、分級控管、fallback 的變更，一律拒絕。

**建議遵守：**

- 重大變更（影響多個模組或流程邊界）建議先以 ADR（Architecture Decision Record）格式記錄決策背景與取捨。

---

## 21. 禁止事項（Non-Negotiable / Anti-Patterns）

以下行為**嚴格禁止**，任何 spec / design / task / 實作不得包含：

1. **不可為快速完成跳過機密防護**：任何機密攔截邏輯不可以「TODO」或「之後再補」方式延後。
2. **不可為輸出流暢度犧牲正確性**：不可調整 prompt 讓模型在低信心時「講得自然一點」而非如實告知不確定。
3. **不可把未核准知識提供給模型**：status 非 `approved` 或 visibility 非 `public` 的知識條目，任何情況下都不得進入對外 prompt context。
4. **不可把 Prompt Guard 只寫在 prompt 中**：必須有後端程式碼層面的顯式判斷；prompt 中的指令是輔助，不是主防線。
5. **不可把業務邏輯寫在 Controller**：Controller 只做 DTO 驗證與路由回應；機密判斷、意圖路由、留資觸發等全在 Service 層。
6. **不可把 RBAC / Auth 列為本期必做**：本期不實作登入與角色驗證；不可因等待 Auth 機制而阻擋核心後端功能交付。
7. **不可使用 `any` 型別**：所有變數與函式參數必須明確定義型別。
8. **不可把對話原始輸入未脫敏存入一般日誌**：使用者輸入在進入日誌前必須先執行 PII redaction。
9. **不可讓甲方資料流入外部模型訓練**：所有 LLM provider API 呼叫必須確認資料不被用於訓練；需確認所使用 provider 的資料政策，並關閉任何允許訓練用途的選項（各 provider 政策不同，須逐一確認）。
10. **不可缺少 fallback**：AI 呼叫路徑必須有明確的降級路徑；fallback 缺失視同功能不完整。

---

## 22. 文件維護規範

- 本 constitution 為 repository 的一部分，存放於 `.specify/memory/constitution.md`。
- 任何修訂必須更新底部的版本記錄。
- constitution 版本號採 `MAJOR.MINOR.PATCH`：核心原則變動為 MAJOR；新增條款為 MINOR；文字修正為 PATCH。
- 下層文件（spec / design / plan / task）若與本 constitution 衝突，以本 constitution 為準，並需同步修正下層文件。
- 定期（每個 major phase 完成後）執行一次 constitution alignment review，確認實作未漂移。

---

## 修訂記錄

| 版本 | 日期 | 修訂摘要 |
|------|------|----------|
| 1.0.0 | 2026-03-30 | 初版建立（安全優先 / 可稽核 / 可靠性三原則） |
| 1.1.0 | 2026-04-08 | 全面改版：依震南官網 AI 客服後端需求補完 22 章節，新增產品邏輯、AI/RAG 安全、DoD、Quality Gate、禁止事項等條文 |
| 1.2.0 | 2026-04-16 | LLM provider 抽象化修訂：①`AiProviderPort` → `ILlmProvider`；②本期預設 `OpenAiProvider`，未來可擴充 `ClaudeProvider`；③環境變數機密管理改為 `LLM_API_KEY`；④資料治理、安全原則、禁止事項等 OpenAI-specific 語言全面改為 provider-neutral；⑤測試原則更新 |

**版本**：1.2.0 | **Ratified**：2026-04-08 | **Last Amended**：2026-04-16
