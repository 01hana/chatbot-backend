import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ITokenizer } from './tokenizer.interface.js';
import { QueryToken } from '../types/query-token.type.js';
import { TokenType } from '../types/token-type.enum.js';

// ── Minimal interface for the nodejieba API ───────────────────────────────────

/**
 * Subset of the nodejieba API used by this tokenizer.
 * Declared inline so the app compiles even when nodejieba is absent.
 */
export interface NodeJiebaModule {
  load(options: { userDict?: string }): void;
  cut(text: string, hmm?: boolean): string[];
}

// ── Classification tables ─────────────────────────────────────────────────────

const PRODUCT_TERMS = new Set([
  '螺絲',
  '螺栓',
  '螺帽',
  '華司',
  '墊圈',
  '鉚釘',
  '螺柱',
  '錨栓',
  '機械螺絲',
  '不鏽鋼螺絲',
  '自攻螺絲',
  '鑽尾螺絲',
  '木螺絲',
  '緊固件',
  '固定件',
  '連接件',
]);

const MATERIAL_TERMS = new Set([
  '不鏽鋼',
  '碳鋼',
  '鍍鋅',
  '鍍鉻',
  '鍍鎳',
  '鋁合金',
  '銅合金',
  '鈦合金',
  '黃銅',
  '不銹鋼',
]);

/**
 * Spec pattern: grade codes (304, 316, 316L, M3…) and standard codes.
 * Applied after set lookups.
 */
const SPEC_RE =
  /^(304|316|316L|410|420|M\d+(\.\d+)?|ISO[-\s]?\d+|DIN[-\s]?\d+|JIS[-\s]?\w+|\d+mm|\d+cm|\d+m)$/i;

const BUSINESS_TERMS = new Set([
  '上班時間',
  '營業時間',
  '公司地址',
  '辦公地址',
  '工作時間',
  '型錄',
  '目錄',
  '報價',
  '詢價',
  '估價',
  '價格',
  '地址',
  '位置',
]);

const CONTACT_TERMS = new Set(['聯絡', '聯絡方式', '業務', '客服', '電話', 'email']);

/**
 * Noise tokens: particles, filler words, pronouns with no semantic value in
 * a product-domain query.  Checked FIRST so high-frequency noise isn't
 * accidentally classified as Unknown.
 */
const NOISE_TERMS = new Set([
  '請問',
  '你們',
  '可以',
  '麻煩',
  '我',
  '的',
  '了',
  '嗎',
  '呢',
  '吧',
  '是',
  '有',
  '要',
  '想',
  '嗨',
  '你',
  '他',
  '她',
  '它',
  '這',
  '那',
  '個',
  '一',
  '在',
  '和',
  '或',
  '也',
  '但',
]);

const WEIGHT_BY_TYPE: Record<TokenType, number> = {
  [TokenType.Product]: 0.9,
  [TokenType.Spec]: 0.85,
  [TokenType.Material]: 0.8,
  [TokenType.Dimension]: 0.75,
  [TokenType.Business]: 0.7,
  [TokenType.Contact]: 0.7,
  [TokenType.Action]: 0.5,
  [TokenType.Unknown]: 0.3,
  [TokenType.Noise]: 0.1,
};

// ── JiebaTokenizer ────────────────────────────────────────────────────────────

/**
 * JiebaTokenizer — implements ITokenizer for Chinese queries using nodejieba.
 *
 * Lifecycle:
 *   1. `onModuleInit()` loads the domain dictionary then dynamically imports
 *      nodejieba.  Either step may fail silently; failures set `_ready=false`
 *      and emit a WARN log.
 *   2. `tokenize()` returns `[]` when `_ready=false` (TokenizerProviderService
 *      falls back to RuleBasedTokenizer in that case).
 *
 * Design constraints:
 *   - Dynamic import uses a variable string so TypeScript does NOT attempt
 *     static resolution of the absent native package at compile time.
 *   - Never throws from any public method.
 *   - No Glossary DB queries (Phase 2 scope only).
 */
@Injectable()
export class JiebaTokenizer implements ITokenizer, OnModuleInit {
  private readonly logger = new Logger(JiebaTokenizer.name);

  private _ready = false;
  private _jiebaModule: NodeJiebaModule | null = null;
  private readonly _dictWords = new Set<string>();

  /**
   * Override the domain dictionary path.  Used only in unit tests to point
   * at a non-existent or controlled file.
   * @internal
   */
  _overrideDictPath: string | null = null;

  /**
   * Inject a mock nodejieba module directly, bypassing the dynamic import.
   * Call this before `onModuleInit()` (or instead of it) in unit tests.
   * @internal
   */
  _setModuleForTesting(mod: NodeJiebaModule): void {
    this._jiebaModule = mod;
    this._ready = true;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.loadDomainDictionary();
    await this.initJieba();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  isReady(): boolean {
    return this._ready;
  }

  /**
   * Classify a single token word.
   *
   * Priority order (first match wins):
   *   1. Noise  (common filler / particles)
   *   2. Product
   *   3. Material
   *   4. Spec   (regex: grade codes / metric sizes)
   *   5. Business (operational keywords)
   *   6. Contact
   *   7. Unknown (default)
   *
   * Public so it can be unit-tested directly without running Jieba.
   */
  public classifyWord(word: string): TokenType {
    if (NOISE_TERMS.has(word)) return TokenType.Noise;
    if (PRODUCT_TERMS.has(word)) return TokenType.Product;
    if (MATERIAL_TERMS.has(word)) return TokenType.Material;
    if (SPEC_RE.test(word)) return TokenType.Spec;
    if (BUSINESS_TERMS.has(word)) return TokenType.Business;
    if (CONTACT_TERMS.has(word)) return TokenType.Contact;
    return TokenType.Unknown;
  }

  async tokenize(text: string, _language: string): Promise<QueryToken[]> {
    if (!this._ready || !this._jiebaModule) {
      return [];
    }

    try {
      const segments = this._jiebaModule.cut(text);
      return segments
        .filter(seg => seg.trim().length > 0)
        .map((seg): QueryToken => {
          const tokenType = this.classifyWord(seg);
          const source: QueryToken['source'] = this._dictWords.has(seg) ? 'dictionary' : 'jieba';
          return {
            text: seg,
            normalizedText: seg,
            tokenType,
            weight: WEIGHT_BY_TYPE[tokenType],
            source,
          };
        });
    } catch {
      this.logger.warn('JiebaTokenizer: tokenize() error, returning []');
      return [];
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private dictPath(): string {
    return this._overrideDictPath ?? resolve(process.cwd(), 'config', 'jieba-domain.txt');
  }

  private async loadDomainDictionary(): Promise<void> {
    const dictPath = this.dictPath();
    try {
      const content = await readFile(dictPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [word] = trimmed.split(/\s+/);
        if (word) this._dictWords.add(word);
      }
      this.logger.log(`JiebaTokenizer: loaded ${this._dictWords.size} domain dictionary entries`);
    } catch {
      this.logger.warn(`JiebaTokenizer: could not load domain dictionary at "${dictPath}"`);
    }
  }

  private async initJieba(): Promise<void> {
    const dictPath = this.dictPath();
    try {
      // Use a variable to prevent TypeScript static module resolution of the
      // potentially-absent native package at compile time.
      const jiebaModuleName = 'nodejieba';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const raw = await import(jiebaModuleName);

      // nodejieba is a CommonJS module; handle both default-export and
      // direct-export shapes produced by different bundlers / Node versions.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const mod = ((raw as any).default ?? raw) as NodeJiebaModule;

      //   mod.load({ userDict: dictPath });
      mod.load({});

      this._jiebaModule = mod;
      this._ready = true;
      this.logger.log('JiebaTokenizer: initialised successfully');
    } catch {
      this._ready = false;
      this.logger.warn(
        'JiebaTokenizer: nodejieba not available — ' +
          'TokenizerProviderService will fall back to RuleBasedTokenizer',
      );
    }
  }
}
