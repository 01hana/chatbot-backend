import { validate } from 'class-validator';
import { AdminWidgetSettingsService } from './widget-settings.service';
import { UpdateWidgetSettingsDto } from './dto/update-widget-settings.dto';

type Entry = {
  key: string;
  value: string;
  description: string | null;
  updatedAt: Date;
};

const now = new Date();

function makeEntry(key: string, value: string, description?: string): Entry {
  return { key, value, description: description ?? null, updatedAt: now };
}

function makePrismaMock(entries: Entry[]) {
  return {
    systemConfig: {
      upsert: jest
        .fn()
        .mockImplementation(
          ({
            where,
            update,
            create,
          }: {
            where: { key: string };
            update: { value: string };
            create: { key: string; value: string; description?: string };
          }) => {
            const existing = entries.find(entry => entry.key === where.key);
            if (existing) {
              existing.value = update.value;
              return Promise.resolve({ ...existing });
            }

            const created = makeEntry(create.key, create.value, create.description);
            entries.push(created);
            return Promise.resolve({ ...created });
          },
        ),
    },
  };
}

function makeSystemConfigMock(entries: Entry[]) {
  const cache = new Map(entries.map(entry => [entry.key, entry.value]));

  return {
    get: jest.fn((key: string) => cache.get(key)),
    invalidateCache: jest.fn().mockImplementation(() => {
      cache.clear();
      for (const entry of entries) {
        cache.set(entry.key, entry.value);
      }
    }),
  };
}

function makeAuditServiceMock() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AdminWidgetSettingsService', () => {
  describe('getSettings()', () => {
    it('returns DB status without applying public degraded override', () => {
      const entries = [
        makeEntry('widget_status', 'offline'),
        makeEntry('widget_welcome_message', JSON.stringify({ 'zh-TW': '您好', en: 'Hello' })),
        makeEntry('widget_quick_replies', JSON.stringify({ 'zh-TW': ['查詢'], en: ['Search'] })),
        makeEntry('widget_disclaimer', JSON.stringify({ 'zh-TW': '提醒', en: 'Notice' })),
        makeEntry(
          'widget_fallback_message',
          JSON.stringify({ 'zh-TW': '稍後再試', en: 'Try later' }),
        ),
      ];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock(entries);
      const auditService = makeAuditServiceMock();
      const service = new AdminWidgetSettingsService(
        prisma as never,
        systemConfig as never,
        auditService as never,
      );

      const result = service.getSettings();

      expect(result.status).toBe('offline');
      expect(result.welcomeMessage).toEqual({ 'zh-TW': '您好', en: 'Hello' });
      expect(result.quickReplies).toEqual({ 'zh-TW': ['查詢'], en: ['Search'] });
    });

    it('falls back to online status and empty objects when keys are missing or invalid JSON is stored', () => {
      const entries = [
        makeEntry('widget_status', 'unexpected'),
        makeEntry('widget_welcome_message', '{bad json'),
        makeEntry('widget_quick_replies', JSON.stringify({ 'zh-TW': 'not an array' })),
        makeEntry('widget_disclaimer', JSON.stringify(['not', 'record'])),
        makeEntry('widget_fallback_message', JSON.stringify({ 'zh-TW': 123 })),
      ];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock(entries);
      const auditService = makeAuditServiceMock();
      const service = new AdminWidgetSettingsService(
        prisma as never,
        systemConfig as never,
        auditService as never,
      );

      const result = service.getSettings();

      expect(result.status).toBe('online');
      expect(result.welcomeMessage).toEqual({});
      expect(result.quickReplies).toEqual({});
      expect(result.disclaimer).toEqual({});
      expect(result.fallbackMessage).toEqual({});
    });

    it('returns empty objects when text keys are missing', () => {
      const entries = [makeEntry('widget_status', 'online')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock(entries);
      const auditService = makeAuditServiceMock();
      const service = new AdminWidgetSettingsService(
        prisma as never,
        systemConfig as never,
        auditService as never,
      );

      const result = service.getSettings();

      expect(result).toEqual({
        status: 'online',
        welcomeMessage: {},
        quickReplies: {},
        disclaimer: {},
        fallbackMessage: {},
      });
    });
  });

  describe('updateSettings()', () => {
    it('upserts one or more supplied settings and returns refreshed settings', async () => {
      const entries = [makeEntry('widget_status', 'online')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock(entries);
      const auditService = makeAuditServiceMock();
      const service = new AdminWidgetSettingsService(
        prisma as never,
        systemConfig as never,
        auditService as never,
      );

      const result = await service.updateSettings({
        status: 'degraded',
        welcomeMessage: { 'zh-TW': '新歡迎', en: 'New welcome' },
      });

      expect(prisma.systemConfig.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'widget_status' },
          update: { value: 'degraded' },
        }),
      );
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'widget_welcome_message' },
          update: { value: JSON.stringify({ 'zh-TW': '新歡迎', en: 'New welcome' }) },
        }),
      );
      expect(result.status).toBe('degraded');
      expect(result.welcomeMessage).toEqual({ 'zh-TW': '新歡迎', en: 'New welcome' });
    });

    it('upserts quick replies and returns refreshed settings', async () => {
      const entries = [makeEntry('widget_status', 'online')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock(entries);
      const auditService = makeAuditServiceMock();
      const service = new AdminWidgetSettingsService(
        prisma as never,
        systemConfig as never,
        auditService as never,
      );

      const result = await service.updateSettings({
        quickReplies: { 'zh-TW': ['查詢產品規格', '聯絡業務'], en: ['Product specs'] },
      });

      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'widget_quick_replies' },
          update: {
            value: JSON.stringify({
              'zh-TW': ['查詢產品規格', '聯絡業務'],
              en: ['Product specs'],
            }),
          },
        }),
      );
      expect(result.quickReplies).toEqual({
        'zh-TW': ['查詢產品規格', '聯絡業務'],
        en: ['Product specs'],
      });
    });

    it('leaves omitted keys untouched', async () => {
      const entries = [
        makeEntry('widget_status', 'online'),
        makeEntry('widget_quick_replies', JSON.stringify({ 'zh-TW': ['原選項'], en: ['Old'] })),
        makeEntry('widget_disclaimer', JSON.stringify({ 'zh-TW': '原提醒', en: 'Old notice' })),
      ];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock(entries);
      const auditService = makeAuditServiceMock();
      const service = new AdminWidgetSettingsService(
        prisma as never,
        systemConfig as never,
        auditService as never,
      );

      await service.updateSettings({ fallbackMessage: { 'zh-TW': '稍後', en: 'Later' } });

      expect(prisma.systemConfig.upsert).toHaveBeenCalledTimes(1);
      expect(systemConfig.get('widget_disclaimer')).toBe(
        JSON.stringify({ 'zh-TW': '原提醒', en: 'Old notice' }),
      );
      expect(systemConfig.get('widget_quick_replies')).toBe(
        JSON.stringify({ 'zh-TW': ['原選項'], en: ['Old'] }),
      );
    });

    it('invalidates SystemConfig cache once after a successful write', async () => {
      const entries = [makeEntry('widget_status', 'online')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock(entries);
      const auditService = makeAuditServiceMock();
      const service = new AdminWidgetSettingsService(
        prisma as never,
        systemConfig as never,
        auditService as never,
      );

      await service.updateSettings({ status: 'offline' });

      expect(systemConfig.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('writes a widget_settings_updated audit event with before and after values', async () => {
      const entries = [
        makeEntry('widget_status', 'online'),
        makeEntry('widget_quick_replies', JSON.stringify({ 'zh-TW': ['舊'], en: ['Old'] })),
      ];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock(entries);
      const auditService = makeAuditServiceMock();
      const service = new AdminWidgetSettingsService(
        prisma as never,
        systemConfig as never,
        auditService as never,
      );

      await service.updateSettings({
        status: 'offline',
        quickReplies: { 'zh-TW': ['新'], en: ['New'] },
      });
      await Promise.resolve();

      expect(auditService.log).toHaveBeenCalledWith({
        eventType: 'widget_settings_updated',
        eventData: {
          keys: ['widget_status', 'widget_quick_replies'],
          before: {
            widget_status: 'online',
            widget_quick_replies: JSON.stringify({ 'zh-TW': ['舊'], en: ['Old'] }),
          },
          after: {
            widget_status: 'offline',
            widget_quick_replies: JSON.stringify({ 'zh-TW': ['新'], en: ['New'] }),
          },
        },
      });
    });

    it('does not write or invalidate cache for an empty patch', async () => {
      const entries = [makeEntry('widget_status', 'online')];
      const prisma = makePrismaMock(entries);
      const systemConfig = makeSystemConfigMock(entries);
      const auditService = makeAuditServiceMock();
      const service = new AdminWidgetSettingsService(
        prisma as never,
        systemConfig as never,
        auditService as never,
      );

      await service.updateSettings({});

      expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
      expect(systemConfig.invalidateCache).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });
});

describe('UpdateWidgetSettingsDto', () => {
  it('accepts valid status and string-record message fields', async () => {
    const dto = Object.assign(new UpdateWidgetSettingsDto(), {
      status: 'online',
      welcomeMessage: { 'zh-TW': '您好', en: 'Hello' },
      quickReplies: { 'zh-TW': ['查詢'], en: ['Search'] },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects invalid status and non-string record values', async () => {
    const dto = Object.assign(new UpdateWidgetSettingsDto(), {
      status: 'busy',
      welcomeMessage: { 'zh-TW': 123 },
    });

    const errors = await validate(dto);

    expect(errors.map(error => error.property)).toEqual(
      expect.arrayContaining(['status', 'welcomeMessage']),
    );
  });

  it('rejects arrays for message fields', async () => {
    const dto = Object.assign(new UpdateWidgetSettingsDto(), {
      disclaimer: ['not', 'an', 'object'],
    });

    const errors = await validate(dto);

    expect(errors.map(error => error.property)).toContain('disclaimer');
  });

  it('rejects invalid quick reply records', async () => {
    const testCases = [
      { quickReplies: ['not', 'an', 'object'] },
      { quickReplies: { 'zh-TW': 'not an array' } },
      { quickReplies: { 'zh-TW': ['查詢', 123] } },
    ];

    for (const value of testCases) {
      const dto = Object.assign(new UpdateWidgetSettingsDto(), value);
      const errors = await validate(dto);

      expect(errors.map(error => error.property)).toContain('quickReplies');
    }
  });
});
