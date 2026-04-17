/**
 * Jest CJS mock for the ESM-only `franc` package.
 *
 * Returns ISO 639-3 codes using the same heuristics that the real franc
 * would produce for Chinese and English text, so ChatPipelineService.detectLang()
 * unit tests work in a Jest (CJS) environment without loading ESM.
 *
 *  - CJK ratio > 30 % → 'cmn'  (Mandarin Chinese)
 *  - ASCII letter ratio > 50 % → 'eng'
 *  - otherwise            → 'und'  (undetermined)
 */

'use strict';

/**
 * @param {string} input
 * @returns {string}
 */
function franc(input) {
  if (!input || input.trim().length === 0) return 'und';

  const cjkMatches = input.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? [];
  if (cjkMatches.length / Math.max(input.length, 1) > 0.3) return 'cmn';

  const asciiMatches = input.match(/[a-zA-Z]/g) ?? [];
  if (asciiMatches.length / Math.max(input.length, 1) > 0.5) return 'eng';

  return 'und';
}

module.exports = { franc };
