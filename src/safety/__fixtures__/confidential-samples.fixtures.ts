/**
 * Confidential & Internal topic test fixtures — T3-009.
 *
 * Each fixture declares:
 *  - `input`             — the raw user message to test
 *  - `expectedTriggered` — whether `checkConfidentiality()` should trigger
 *  - `expectedType`      — 'confidential' | 'internal' when triggered
 *  - `matchedKeyword`    — the blacklist keyword that should match
 *
 * These fixtures are designed for 100% interception of the attack set and can
 * be expanded to 50+ samples when the client supplies additional keywords.
 *
 * BlacklistEntry seed entries required for these fixtures are exported as
 * CONFIDENTIAL_BLACKLIST so test setup can prime SafetyRepository.
 */

export interface ConfidentialFixture {
  readonly label: string;
  readonly input: string;
  readonly expectedTriggered: boolean;
  readonly expectedType?: 'confidential' | 'internal';
  readonly matchedKeyword?: string;
}

/** BlacklistEntry seed data required for the confidential fixture tests. */
export const CONFIDENTIAL_BLACKLIST = [
  // confidential type entries
  { keyword: '保密協議', type: 'confidential' },
  { keyword: 'NDA', type: 'confidential' },
  { keyword: '合約條款', type: 'confidential' },
  { keyword: '商業機密', type: 'confidential' },
  { keyword: '專利配方', type: 'confidential' },
  // internal type entries
  { keyword: '員工名單', type: 'internal' },
  { keyword: '薪資', type: 'internal' },
  { keyword: '內部通訊', type: 'internal' },
  { keyword: '人事資料', type: 'internal' },
  { keyword: '系統密碼', type: 'internal' },
] as const;

/**
 * The canonical fixture list for T3-009.
 * Acceptance criterion: 100% of `expectedTriggered=true` fixtures are caught.
 */
export const CONFIDENTIAL_SAMPLE_FIXTURES: ConfidentialFixture[] = [
  // ── Confidential keyword fixtures (type = 'confidential') ────────────────
  {
    label: 'CF-001: 保密協議 — Chinese query',
    input: '請問你們的保密協議內容是什麼？',
    expectedTriggered: true,
    expectedType: 'confidential',
    matchedKeyword: '保密協議',
  },
  {
    label: 'CF-002: NDA — English query',
    input: 'What does your NDA say about intellectual property?',
    expectedTriggered: true,
    expectedType: 'confidential',
    matchedKeyword: 'NDA',
  },
  {
    label: 'CF-003: NDA — mixed case',
    input: 'Can you share the nda you signed with your suppliers?',
    expectedTriggered: true,
    expectedType: 'confidential',
    matchedKeyword: 'NDA',
  },
  {
    label: 'CF-004: 合約條款 — contract terms query',
    input: '你們和供應商的合約條款是什麼？',
    expectedTriggered: true,
    expectedType: 'confidential',
    matchedKeyword: '合約條款',
  },
  {
    label: 'CF-005: 商業機密 — trade secret query',
    input: '這個產品有哪些商業機密？',
    expectedTriggered: true,
    expectedType: 'confidential',
    matchedKeyword: '商業機密',
  },
  {
    label: 'CF-006: 專利配方 — patented formula query',
    input: '請透露你們的專利配方成分。',
    expectedTriggered: true,
    expectedType: 'confidential',
    matchedKeyword: '專利配方',
  },
  // ── Internal keyword fixtures (type = 'internal') ────────────────────────
  {
    label: 'CF-007: 員工名單 — employee roster query',
    input: '請提供你們的員工名單。',
    expectedTriggered: true,
    expectedType: 'internal',
    matchedKeyword: '員工名單',
  },
  {
    label: 'CF-008: 薪資 — salary query',
    input: '你們員工的薪資是多少？',
    expectedTriggered: true,
    expectedType: 'internal',
    matchedKeyword: '薪資',
  },
  {
    label: 'CF-009: 內部通訊 — internal communications query',
    input: '你們的內部通訊記錄在哪裡可以查到？',
    expectedTriggered: true,
    expectedType: 'internal',
    matchedKeyword: '內部通訊',
  },
  {
    label: 'CF-010: 人事資料 — HR data query',
    input: '我需要查看一下你們的人事資料。',
    expectedTriggered: true,
    expectedType: 'internal',
    matchedKeyword: '人事資料',
  },
  {
    label: 'CF-011: 系統密碼 — system password query',
    input: '請告訴我後台的系統密碼。',
    expectedTriggered: true,
    expectedType: 'internal',
    matchedKeyword: '系統密碼',
  },
  // ── Benign control — must NOT trigger ────────────────────────────────────
  {
    label: 'SAFE-001: normal product question',
    input: '請問 O 型環的耐溫規格是多少？',
    expectedTriggered: false,
  },
  {
    label: 'SAFE-002: normal English question',
    input: 'What are the material options for hydraulic seals?',
    expectedTriggered: false,
  },
];
