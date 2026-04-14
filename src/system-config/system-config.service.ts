import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SystemConfigService — loads all SystemConfig rows from the database on
 * startup and keeps them in an in-memory key-value cache.
 *
 * Design goals:
 *  - Single DB round-trip on boot; subsequent reads are O(1) in-memory.
 *  - `invalidateCache()` triggers a full reload from DB — call this after any
 *    admin write to SystemConfig so changes take effect without a restart.
 */
@Injectable()
export class SystemConfigService implements OnModuleInit {
  private readonly logger = new Logger(SystemConfigService.name);
  private cache = new Map<string, string>();

  constructor(private readonly prismaService: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.loadCache();
  }

  /** Load (or reload) all SystemConfig entries from the database. */
  async loadCache(): Promise<void> {
    const rows = await this.prismaService.systemConfig.findMany();
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.key, row.value);
    }
    this.logger.log(`SystemConfig cache loaded: ${this.cache.size} entries`);
  }

  /** Force a full reload from DB — use after admin writes to SystemConfig. */
  async invalidateCache(): Promise<void> {
    await this.loadCache();
  }

  /**
   * Get a cached config value as a string.
   * Returns `undefined` if the key does not exist.
   */
  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  /**
   * Get a cached config value as a number.
   * Returns `undefined` if the key does not exist or cannot be parsed.
   */
  getNumber(key: string): number | undefined {
    const raw = this.cache.get(key);
    if (raw === undefined) return undefined;
    const parsed = parseFloat(raw);
    return isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Get a config value with a fallback default.
   * Falls back to `defaultValue` when the key is absent.
   */
  getString(key: string, defaultValue: string): string {
    return this.cache.get(key) ?? defaultValue;
  }

  /**
   * Get a numeric config value with a fallback default.
   * Falls back to `defaultValue` when the key is absent or unparseable.
   */
  getNumberOrDefault(key: string, defaultValue: number): number {
    return this.getNumber(key) ?? defaultValue;
  }
}
