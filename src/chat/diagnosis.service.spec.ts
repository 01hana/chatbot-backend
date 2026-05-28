import { DiagnosisService } from './diagnosis.service';
import { DiagnosisContext } from './types/diagnosis-context.type';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a mock IntentService with an empty template cache by default. */
function makeIntentServiceMock(
  templates: Array<{ intent: string; templateZh: string; templateEn: string; isActive: boolean }> = [],
) {
  return {
    getCachedTemplates: jest.fn().mockReturnValue(templates),
  };
}

/** Shorthand to create a DiagnosisService with the given templates. */
function makeService(
  templates: Array<{ intent: string; templateZh: string; templateEn: string; isActive: boolean }> = [],
) {
  return new DiagnosisService(makeIntentServiceMock(templates) as never);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DiagnosisService', () => {
  // ── initContext ────────────────────────────────────────────────────────────

  describe('initContext()', () => {
    it('returns stage=idle and currentField=purpose', () => {
      const svc = makeService();
      const ctx = svc.initContext();

      expect(ctx.stage).toBe('idle');
      expect(ctx.currentField).toBe('purpose');
    });

    it('requiredFields follows fixed order: purpose→material→length→environment', () => {
      const svc = makeService();
      const ctx = svc.initContext();

      expect(ctx.requiredFields).toEqual(['purpose', 'material', 'length', 'environment']);
    });

    it('collectedFields starts empty', () => {
      const svc = makeService();
      const ctx = svc.initContext();

      expect(ctx.collectedFields).toEqual({});
    });
  });

  // ── startOrContinue ────────────────────────────────────────────────────────

  describe('startOrContinue()', () => {
    it('null context → stage=collecting, currentField=purpose', () => {
      const svc = makeService();
      const ctx = svc.startOrContinue(null);

      expect(ctx.stage).toBe('collecting');
      expect(ctx.currentField).toBe('purpose');
    });

    it('undefined context → stage=collecting, currentField=purpose', () => {
      const svc = makeService();
      const ctx = svc.startOrContinue(undefined);

      expect(ctx.stage).toBe('collecting');
      expect(ctx.currentField).toBe('purpose');
    });

    it('idle context → advances to collecting', () => {
      const svc = makeService();
      const ctx = svc.startOrContinue(svc.initContext());

      expect(ctx.stage).toBe('collecting');
    });

    it('collecting context → healed and returned with same values', () => {
      const svc = makeService();
      const collecting = svc.startOrContinue(null);
      const again = svc.startOrContinue(collecting);

      expect(again.stage).toBe('collecting');
      expect(again.currentField).toBe('purpose');
      expect(again.collectedFields).toEqual({});
    });

    it('complete context → not reset', () => {
      const svc = makeService();
      const complete: DiagnosisContext = {
        stage: 'complete',
        collectedFields: { purpose: 'a', material: 'b', length: 'c', environment: 'd' },
        requiredFields: ['purpose', 'material', 'length', 'environment'],
        currentField: null,
      };
      const result = svc.startOrContinue(complete);

      expect(result.stage).toBe('complete');
    });

    it('recommended context → not reset', () => {
      const svc = makeService();
      const recommended: DiagnosisContext = {
        stage: 'recommended',
        collectedFields: { purpose: 'a', material: 'b', length: 'c', environment: 'd' },
        requiredFields: ['purpose', 'material', 'length', 'environment'],
        currentField: null,
      };
      const result = svc.startOrContinue(recommended);

      expect(result.stage).toBe('recommended');
    });
  });

  // ── processAnswer traversal ────────────────────────────────────────────────

  describe('processAnswer() — field traversal', () => {
    it('answering purpose → currentField=material', () => {
      const svc = makeService();
      const ctx = svc.startOrContinue(null);
      const next = svc.processAnswer(ctx, 'purpose', 'outdoor lighting');

      expect(next.currentField).toBe('material');
      expect(next.stage).toBe('collecting');
    });

    it('answering material → currentField=length', () => {
      const svc = makeService();
      let ctx = svc.startOrContinue(null);
      ctx = svc.processAnswer(ctx, 'purpose', 'outdoor lighting');
      ctx = svc.processAnswer(ctx, 'material', 'aluminum');

      expect(ctx.currentField).toBe('length');
      expect(ctx.stage).toBe('collecting');
    });

    it('answering length → currentField=environment', () => {
      const svc = makeService();
      let ctx = svc.startOrContinue(null);
      ctx = svc.processAnswer(ctx, 'purpose', 'outdoor lighting');
      ctx = svc.processAnswer(ctx, 'material', 'aluminum');
      ctx = svc.processAnswer(ctx, 'length', '2m');

      expect(ctx.currentField).toBe('environment');
      expect(ctx.stage).toBe('collecting');
    });

    it('answering all four fields → stage=complete, currentField=null', () => {
      const svc = makeService();
      let ctx = svc.startOrContinue(null);
      ctx = svc.processAnswer(ctx, 'purpose', 'outdoor lighting');
      ctx = svc.processAnswer(ctx, 'material', 'aluminum');
      ctx = svc.processAnswer(ctx, 'length', '2m');
      ctx = svc.processAnswer(ctx, 'environment', 'outdoor');

      expect(ctx.stage).toBe('complete');
      expect(ctx.currentField).toBeNull();
    });

    it('already-filled fields are not re-asked', () => {
      const svc = makeService();
      // Manually construct a context with purpose already filled
      const ctx: DiagnosisContext = {
        stage: 'collecting',
        collectedFields: { purpose: 'indoor signage' },
        requiredFields: ['purpose', 'material', 'length', 'environment'],
        currentField: 'material',
      };

      const next = svc.getNextMissingField(ctx);
      expect(next).toBe('material'); // purpose already done
    });
  });

  // ── blank answer guard ─────────────────────────────────────────────────────

  describe('processAnswer() — blank value handling', () => {
    it('blank value does not overwrite an existing field', () => {
      const svc = makeService();
      let ctx = svc.startOrContinue(null);
      ctx = svc.processAnswer(ctx, 'purpose', 'outdoor lighting');

      // Try to overwrite with blank
      const after = svc.processAnswer(ctx, 'purpose', '   ');

      expect(after.collectedFields.purpose).toBe('outdoor lighting');
    });

    it('blank value on an empty field leaves the field unanswered', () => {
      const svc = makeService();
      const ctx = svc.startOrContinue(null);

      const after = svc.processAnswer(ctx, 'purpose', '');

      expect(after.collectedFields.purpose).toBeUndefined();
      expect(after.currentField).toBe('purpose'); // still asking
    });

    it('whitespace-only value is trimmed and treated as blank', () => {
      const svc = makeService();
      const ctx = svc.startOrContinue(null);

      const after = svc.processAnswer(ctx, 'purpose', '   \t  ');

      expect(after.collectedFields.purpose).toBeUndefined();
    });
  });

  // ── isComplete ────────────────────────────────────────────────────────────

  describe('isComplete()', () => {
    it('returns false when no fields are collected', () => {
      const svc = makeService();
      const ctx = svc.startOrContinue(null);

      expect(svc.isComplete(ctx)).toBe(false);
    });

    it('returns false when only some fields are collected', () => {
      const svc = makeService();
      const ctx: DiagnosisContext = {
        stage: 'collecting',
        collectedFields: { purpose: 'a', material: 'b' },
        requiredFields: ['purpose', 'material', 'length', 'environment'],
        currentField: 'length',
      };

      expect(svc.isComplete(ctx)).toBe(false);
    });

    it('returns true when all four fields are present and non-blank', () => {
      const svc = makeService();
      const ctx: DiagnosisContext = {
        stage: 'complete',
        collectedFields: { purpose: 'a', material: 'b', length: 'c', environment: 'd' },
        requiredFields: ['purpose', 'material', 'length', 'environment'],
        currentField: null,
      };

      expect(svc.isComplete(ctx)).toBe(true);
    });

    it('returns false when a field is whitespace-only', () => {
      const svc = makeService();
      const ctx: DiagnosisContext = {
        stage: 'collecting',
        collectedFields: { purpose: '  ', material: 'b', length: 'c', environment: 'd' },
        requiredFields: ['purpose', 'material', 'length', 'environment'],
        currentField: 'purpose',
      };

      expect(svc.isComplete(ctx)).toBe(false);
    });
  });

  // ── getNextQuestion — fallback ─────────────────────────────────────────────

  describe('getNextQuestion() — fallback (no templates)', () => {
    it('returns zh-TW fallback for purpose when language is zh-TW', () => {
      const svc = makeService(); // no templates
      const ctx = svc.startOrContinue(null);

      const q = svc.getNextQuestion(ctx, 'zh-TW');
      expect(q).toBe('請問您的使用用途是什麼？');
    });

    it('returns en fallback for purpose when language is en', () => {
      const svc = makeService();
      const ctx = svc.startOrContinue(null);

      const q = svc.getNextQuestion(ctx, 'en');
      expect(q).toBe('What is the intended use?');
    });

    it('returns zh fallback for material', () => {
      const svc = makeService();
      let ctx = svc.startOrContinue(null);
      ctx = svc.processAnswer(ctx, 'purpose', 'a');

      expect(svc.getNextQuestion(ctx, 'zh')).toBe('請問您需要的材質是什麼？');
    });

    it('returns en fallback for length', () => {
      const svc = makeService();
      let ctx = svc.startOrContinue(null);
      ctx = svc.processAnswer(ctx, 'purpose', 'a');
      ctx = svc.processAnswer(ctx, 'material', 'b');

      expect(svc.getNextQuestion(ctx, 'en')).toBe('What length or size range do you need?');
    });

    it('returns en fallback for environment', () => {
      const svc = makeService();
      let ctx = svc.startOrContinue(null);
      ctx = svc.processAnswer(ctx, 'purpose', 'a');
      ctx = svc.processAnswer(ctx, 'material', 'b');
      ctx = svc.processAnswer(ctx, 'length', 'c');

      expect(svc.getNextQuestion(ctx, 'en')).toBe('What is the usage environment?');
    });

    it('returns empty string when context is complete', () => {
      const svc = makeService();
      const ctx: DiagnosisContext = {
        stage: 'complete',
        collectedFields: { purpose: 'a', material: 'b', length: 'c', environment: 'd' },
        requiredFields: ['purpose', 'material', 'length', 'environment'],
        currentField: null,
      };

      expect(svc.getNextQuestion(ctx, 'zh-TW')).toBe('');
    });
  });

  // ── getNextQuestion — template lookup ─────────────────────────────────────

  describe('getNextQuestion() — IntentTemplate lookup', () => {
    it('uses templateZh from IntentTemplate when intent matches', () => {
      const templates = [
        { intent: 'diagnosis.purpose', templateZh: '您的主要用途是？', templateEn: 'Your main purpose?', isActive: true },
      ];
      const svc = makeService(templates);
      const ctx = svc.startOrContinue(null);

      expect(svc.getNextQuestion(ctx, 'zh-TW')).toBe('您的主要用途是？');
    });

    it('uses templateEn from IntentTemplate when language is en', () => {
      const templates = [
        { intent: 'diagnosis.purpose', templateZh: '您的主要用途是？', templateEn: 'Your main purpose?', isActive: true },
      ];
      const svc = makeService(templates);
      const ctx = svc.startOrContinue(null);

      expect(svc.getNextQuestion(ctx, 'en')).toBe('Your main purpose?');
    });

    it('falls back when template isActive=false', () => {
      const templates = [
        { intent: 'diagnosis.purpose', templateZh: '停用的問題', templateEn: 'Disabled question', isActive: false },
      ];
      const svc = makeService(templates);
      const ctx = svc.startOrContinue(null);

      // Should fall back to built-in copy
      expect(svc.getNextQuestion(ctx, 'zh-TW')).toBe('請問您的使用用途是什麼？');
    });

    it('falls back to hardcoded text when no matching template exists', () => {
      const templates = [
        { intent: 'diagnosis.material', templateZh: '材質模板', templateEn: 'material template', isActive: true },
      ];
      const svc = makeService(templates);
      const ctx = svc.startOrContinue(null); // currentField=purpose, no template for purpose

      expect(svc.getNextQuestion(ctx, 'zh-TW')).toBe('請問您的使用用途是什麼？');
    });

    it('treats template without isActive field as active', () => {
      // Simulates legacy DB rows that predate the isActive column
      const templates = [
        { intent: 'diagnosis.purpose', templateZh: '舊版問題', templateEn: 'Legacy question' },
      ];
      const svc = makeService(templates as never);
      const ctx = svc.startOrContinue(null);

      expect(svc.getNextQuestion(ctx, 'zh-TW')).toBe('舊版問題');
    });

    it('falls back when template isActive is explicitly false', () => {
      const templates = [
        { intent: 'diagnosis.purpose', templateZh: '停用的問題', templateEn: 'Disabled question', isActive: false },
      ];
      const svc = makeService(templates);
      const ctx = svc.startOrContinue(null);

      expect(svc.getNextQuestion(ctx, 'zh-TW')).toBe('請問您的使用用途是什麼？');
    });
  });

  // ── startOrContinue — collecting context healing ──────────────────────────

  describe('startOrContinue() — collecting context repair', () => {
    it('repairs currentField=null when purpose is already filled', () => {
      const svc = makeService();
      const ctx: DiagnosisContext = {
        stage: 'collecting',
        collectedFields: { purpose: 'outdoor lighting' },
        requiredFields: ['purpose', 'material', 'length', 'environment'],
        currentField: null, // stale / corrupt pointer
      };

      const repaired = svc.startOrContinue(ctx);
      expect(repaired.currentField).toBe('material');
      expect(repaired.stage).toBe('collecting');
    });

    it('promotes to complete when all four fields are already filled', () => {
      const svc = makeService();
      const ctx: DiagnosisContext = {
        stage: 'collecting',
        collectedFields: { purpose: 'a', material: 'b', length: 'c', environment: 'd' },
        requiredFields: ['purpose', 'material', 'length', 'environment'],
        currentField: 'environment', // stale — all fields already answered
      };

      const repaired = svc.startOrContinue(ctx);
      expect(repaired.stage).toBe('complete');
      expect(repaired.currentField).toBeNull();
    });

    it('does not reset collectedFields during repair', () => {
      const svc = makeService();
      const ctx: DiagnosisContext = {
        stage: 'collecting',
        collectedFields: { purpose: 'outdoor lighting', material: 'aluminum' },
        requiredFields: ['purpose', 'material', 'length', 'environment'],
        currentField: null,
      };

      const repaired = svc.startOrContinue(ctx);
      expect(repaired.collectedFields.purpose).toBe('outdoor lighting');
      expect(repaired.collectedFields.material).toBe('aluminum');
    });
  });
});
