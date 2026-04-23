import { Injectable, Logger } from '@nestjs/common';
import { IQueryRuleProvider } from '../interfaces/query-rule-provider.interface';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Hardcoded fallback stop-word sets — mirrors RuleBasedQueryAnalyzer exactly.
 * Used when the `query_rules` table returns no data (e.g. empty DB in tests).
 */
const FALLBACK_STOP_WORDS: Record<string, Set<string>> = {
  'zh-TW': new Set([
    '請問', '請問一下', '想問', '想問一下', '我想問', '請幫我', '幫我查',
    '查一下', '告訴我', '想知道', '麻煩你', '請告訴我', '我想了解', '能告訴我',
    '你好', '謝謝',
  ]),
  en: new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
    'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
    'should', 'may', 'might', 'i', 'we', 'you', 'it', 'its', 'my',
    'your', 'our', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'from',
    'with', 'and', 'or', 'not', 'that', 'this', 'these', 'those',
  ]),
};

const FALLBACK_NOISE_WORDS: Record<string, Set<string>> = {
  'zh-TW': new Set(['一些', '一下', '一點', '相關']),
  en: new Set(),
};

const FALLBACK_QUESTION_SHELL_PATTERNS: Record<string, RegExp[]> = {
  'zh-TW': [
    /^(請問(?:一下)?|想問(?:一下)?|我想問|請幫我|幫我查|查一下|告訴我|想知道|麻煩你|請告訴我|我想了解|能告訴我)[，,\s]*/u,
    /^(如何|怎麼|怎樣|可以|有沒有辦法|能否)/u,
    /\s*(有哪些|有哪幾種|有什麼|是什麼|怎麼樣|可以嗎|嗎|呢|啊|喔|好嗎)[？?！!。.…]*$/u,
  ],
  en: [
    /^(how\s+(?:can|do|could|would|should)\s+(?:i|we|you|one)\s+|how\s+to\s+|what\s+(?:are\s+the\s+|is\s+the\s+|types\s+of\s+|kind\s+of\s+)?|what\s+|where\s+can\s+(?:i|we)\s+|where\s+do\s+(?:i|we)\s+|can\s+(?:i|we|you)\s+|is\s+there\s+(?:a\s+way\s+to\s+)?|do\s+you\s+(?:have\s+|offer\s+|provide\s+)?|please\s+(?:tell\s+me\s+(?:about\s+)?)?|could\s+you\s+(?:tell\s+me\s+(?:about\s+)?)?)/i,
    /\s*(do\s+you\s+(?:have|offer|provide|carry)|can\s+you\s+(?:tell\s+me)?)[?!.]*$/i,
  ],
};

/** Shape of one in-memory rule cache entry. */
interface RuleCache {
  stopWords: Map<string, Set<string>>;
  noiseWords: Map<string, Set<string>>;
  questionShellPatterns: Map<string, RegExp[]>;
  loadedAt: number;
}

/**
 * DbQueryRuleProvider — IQueryRuleProvider backed by the `query_rules` table.
 *
 * On first access per rule type, rules are fetched from DB and cached in memory.
 * `invalidateCache()` clears the cache so the next read re-fetches from DB.
 *
 * Fallback: if DB returns zero active rules for a given language and type, the
 * hardcoded constants above are used, ensuring identical behaviour to the
 * pre-DB RuleBasedQueryAnalyzer.
 */
@Injectable()
export class DbQueryRuleProvider implements IQueryRuleProvider {
  private readonly logger = new Logger(DbQueryRuleProvider.name);
  private cache: RuleCache | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ── IQueryRuleProvider ────────────────────────────────────────────────────

  async getStopWords(language: string): Promise<Set<string>> {
    const cache = await this.ensureCache();
    const fromDb = cache.stopWords.get(language);
    if (fromDb && fromDb.size > 0) return fromDb;
    // Fallback to hardcoded when DB has no data for this language.
    return FALLBACK_STOP_WORDS[language] ?? new Set();
  }

  async getNoiseWords(language: string): Promise<Set<string>> {
    const cache = await this.ensureCache();
    const fromDb = cache.noiseWords.get(language);
    if (fromDb && fromDb.size > 0) return fromDb;
    return FALLBACK_NOISE_WORDS[language] ?? new Set();
  }

  async getQuestionShellPatterns(language: string): Promise<RegExp[]> {
    const cache = await this.ensureCache();
    const fromDb = cache.questionShellPatterns.get(language);
    if (fromDb && fromDb.length > 0) return fromDb;
    return FALLBACK_QUESTION_SHELL_PATTERNS[language] ?? [];
  }

  /** Clear the in-memory cache. The next getter call re-fetches from DB. */
  invalidateCache(): void {
    this.cache = null;
    this.logger.log('DbQueryRuleProvider cache invalidated');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async ensureCache(): Promise<RuleCache> {
    if (this.cache !== null) return this.cache;

    this.logger.debug('Loading QueryRules from DB...');

    const rows = await this.prisma.queryRule.findMany({
      where: { isActive: true },
      orderBy: { priority: 'desc' },
    });

    const stopWords = new Map<string, Set<string>>();
    const noiseWords = new Map<string, Set<string>>();
    const questionShellPatterns = new Map<string, RegExp[]>();

    for (const row of rows) {
      const lang = row.language;

      if (row.type === 'stop_word') {
        if (!stopWords.has(lang)) stopWords.set(lang, new Set());
        stopWords.get(lang)!.add(row.value);
      } else if (row.type === 'noise_word') {
        if (!noiseWords.has(lang)) noiseWords.set(lang, new Set());
        noiseWords.get(lang)!.add(row.value);
      } else if (row.type === 'question_shell_zh' || row.type === 'question_shell_en') {
        if (!questionShellPatterns.has(lang)) questionShellPatterns.set(lang, []);
        try {
          // Patterns stored with flags suffix: "pattern|flags" or just "pattern"
          questionShellPatterns.get(lang)!.push(new RegExp(row.value, 'u'));
        } catch (err) {
          this.logger.warn(`Invalid regex in QueryRule id=${row.id}: ${String(err)}`);
        }
      }
    }

    this.cache = { stopWords, noiseWords, questionShellPatterns, loadedAt: Date.now() };
    this.logger.log(`DbQueryRuleProvider cache loaded: ${rows.length} rules`);
    return this.cache;
  }
}
