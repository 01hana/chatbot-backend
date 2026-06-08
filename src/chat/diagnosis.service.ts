import { Injectable } from '@nestjs/common';
import { IntentService } from '../intent/intent.service';
import { DiagnosisContext, DiagnosisFields } from './types/diagnosis-context.type';

/**
 * DiagnosisService — state-machine for the four-field product-diagnosis flow.
 *
 * The traversal order is fixed:
 *   purpose → material → length → environment
 *
 * The LLM is never consulted to decide the next question.
 *
 * Question text is resolved in this priority order:
 *   1. IntentTemplate row whose `title` matches `diagnosis.<field>` (zh or en).
 *   2. Built-in fallback strings (hardcoded below).
 *
 * The hardcoded strings are intentional fallback text only. Production deployments
 * should seed corresponding IntentTemplate rows (title = "diagnosis.purpose" etc.)
 * so that question copy can be updated via the admin API without a code deploy.
 */
@Injectable()
export class DiagnosisService {
  /** Fixed traversal order — must never be reordered or derived from LLM output. */
  static readonly REQUIRED_FIELDS: ReadonlyArray<keyof DiagnosisFields> = [
    'purpose',
    'material',
    'length',
    'environment',
  ] as const;

  // ─── Fallback question copy (used when no IntentTemplate row exists) ───────

  private static readonly FALLBACK_ZH: Record<keyof DiagnosisFields, string> = {
    purpose: '請問您的使用用途是什麼？',
    material: '請問您需要的材質是什麼？',
    length: '請問您需要的長度或尺寸範圍是什麼？',
    environment: '請問使用環境是室內、室外、潮濕或特殊環境嗎？',
  };

  private static readonly FALLBACK_EN: Record<keyof DiagnosisFields, string> = {
    purpose: 'What is the intended use?',
    material: 'What material do you need?',
    length: 'What length or size range do you need?',
    environment: 'What is the usage environment?',
  };

  constructor(private readonly intentService: IntentService) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Create a brand-new context in `idle` stage, pointing at the first field.
   */
  initContext(): DiagnosisContext {
    return {
      stage: 'idle',
      collectedFields: {},
      requiredFields: [...DiagnosisService.REQUIRED_FIELDS],
      currentField: 'purpose',
    };
  }

  /**
   * Start or resume a diagnosis flow.
   *
   * - Null / undefined context  → creates a new one and advances to 'collecting'.
   * - idle context              → advances to 'collecting'.
   * - collecting context        → returned repaired and resumed (already in progress).
   * - complete / recommended    → returned as-is (must not reset a finished flow).
   */
  startOrContinue(context?: DiagnosisContext | null): DiagnosisContext {
    if (!context) {
      return {
        ...this.initContext(),
        stage: 'collecting',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    if (context.stage === 'idle') {
      return { ...context, stage: 'collecting', updatedAt: new Date().toISOString() };
    }

    if (context.stage === 'collecting') {
      // Ensure requiredFields is always the canonical ordered list.
      const healed: DiagnosisContext = {
        ...context,
        requiredFields: [...DiagnosisService.REQUIRED_FIELDS],
      };
      const next = this.getNextMissingField(healed);
      if (next === null) {
        return {
          ...healed,
          stage: 'complete',
          currentField: null,
          updatedAt: new Date().toISOString(),
        };
      }
      return { ...healed, currentField: next };
    }

    // complete / recommended — return unchanged
    return context;
  }

  /**
   * Return the first required field that has not yet been answered, following
   * the fixed order. Returns null when all fields are present.
   */
  getNextMissingField(context: DiagnosisContext): keyof DiagnosisFields | null {
    for (const field of DiagnosisService.REQUIRED_FIELDS) {
      const value = context.collectedFields[field];
      if (value === undefined || value === null || value.trim() === '') {
        return field;
      }
    }
    return null;
  }

  /**
   * Record the user's answer for `field` and advance the state machine.
   *
   * - Blank / whitespace-only answers are ignored (existing value preserved).
   * - After all four fields are filled: stage → 'complete', currentField → null.
   * - Otherwise: stage → 'collecting', currentField → next missing field.
   */
  processAnswer(
    context: DiagnosisContext,
    field: keyof DiagnosisFields,
    value: string,
  ): DiagnosisContext {
    const trimmed = value.trim();

    const updatedFields: Partial<DiagnosisFields> = { ...context.collectedFields };

    if (trimmed !== '') {
      updatedFields[field] = trimmed;
    }

    const next = this.getNextMissingField({ ...context, collectedFields: updatedFields });
    const complete = next === null;

    return {
      ...context,
      collectedFields: updatedFields,
      stage: complete ? 'complete' : 'collecting',
      currentField: complete ? null : next,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Returns true only when all four required fields contain a non-blank value.
   */
  isComplete(context: DiagnosisContext): boolean {
    return DiagnosisService.REQUIRED_FIELDS.every(field => {
      const value = context.collectedFields[field];
      return value !== undefined && value !== null && value.trim() !== '';
    });
  }

  /**
   * Resolve the question text for the next missing field.
   *
   * Lookup order:
   *   1. IntentTemplate row with `title = "diagnosis.<field>"` (templateZh / templateEn).
   *   2. Built-in fallback strings.
   *
   * Returns an empty string when the context is already complete (no pending field).
   *
   * @param context  Current diagnosis context.
   * @param language ISO language tag; 'zh' prefix routes to templateZh, otherwise templateEn.
   */
  getNextQuestion(context: DiagnosisContext, language: string): string {
    const field = this.getNextMissingField(context);
    if (!field) return '';

    const titleKey = `diagnosis.${field}`;
    const templates = this.intentService.getCachedTemplates();
    // isActive === false means explicitly disabled; undefined / true means active.
    const template = templates.find(t => t.title === titleKey && t.isActive !== false);

    const isZh = language.startsWith('zh');

    if (template) {
      return isZh ? template.templateZh : template.templateEn;
    }

    // Fallback copy — used when no seed data exists for the title key.
    return isZh ? DiagnosisService.FALLBACK_ZH[field] : DiagnosisService.FALLBACK_EN[field];
  }
}
