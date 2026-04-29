/**
 * faq-en.fixtures.ts — English Golden FAQ Fixtures (RG-002)
 *
 * 10 English FAQ query fixtures used as baseline for retrieval regression.
 *
 * `expectedSourceKey`: KnowledgeEntry.sourceKey expected in top-3 results.
 * `expectedTerms`:     Terms that QueryNormalizer / RuleBasedQueryAnalyzer
 *                      should extract to enable correct retrieval.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  CI Baseline (2026-04-28, seed v002)                                     │
 * │  Target: top-3 hit rate ≥ 90% (9/10)                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { FaqFixture } from './faq-zh.fixtures';

export const FAQ_EN_FIXTURES: FaqFixture[] = [
  // ── Screw products ──────────────────────────────────────────────────────
  {
    query: 'What types of screws do you offer?',
    language: 'en',
    expectedSourceKey: 'screw-overview',
    expectedAction: 'answer',
    expectedTerms: ['screw'],
  },
  {
    query: 'Do you carry self-drilling screws for metal?',
    language: 'en',
    expectedSourceKey: 'screw-self-drilling',
    expectedAction: 'answer',
    expectedTerms: ['self-drilling', 'screw'],
  },
  {
    query: 'What are roofing screws used for?',
    language: 'en',
    expectedSourceKey: 'screw-roofing',
    expectedAction: 'answer',
    expectedTerms: ['roofing', 'screw'],
  },
  {
    query: 'What is the difference between 304 and 316 stainless steel screws?',
    language: 'en',
    expectedSourceKey: 'screw-stainless',
    expectedAction: 'answer',
    expectedTerms: ['stainless', 'screw'],
  },
  // ── Wire products ────────────────────────────────────────────────────────
  {
    query: 'What wire diameters are available?',
    language: 'en',
    expectedSourceKey: 'wire-overview',
    expectedAction: 'answer',
    expectedTerms: ['wire'],
  },
  {
    query: 'What are the applications for alloy steel wire?',
    language: 'en',
    expectedSourceKey: 'wire-alloy-steel',
    expectedAction: 'answer',
    expectedTerms: ['alloy', 'wire'],
  },
  {
    query: 'Which wire material should I choose for corrosion resistance?',
    language: 'en',
    expectedSourceKey: 'wire-stainless-steel',
    expectedAction: 'answer',
    expectedTerms: ['wire', 'corrosion'],
  },
  // ── Company info ─────────────────────────────────────────────────────────
  {
    query: 'Where is Chen Nan Iron Wire located?',
    language: 'en',
    expectedSourceKey: 'company-overview',
    expectedAction: 'answer',
    expectedTerms: ['Chen Nan'],
  },
  {
    query: 'How can I contact your company for a quote?',
    language: 'en',
    expectedSourceKey: 'contact-inquiry',
    expectedAction: 'answer',
    expectedTerms: ['contact'],
  },
  // ── Bolts ─────────────────────────────────────────────────────────────────
  {
    query: 'What bolt sizes and grades do you carry?',
    language: 'en',
    expectedSourceKey: 'bolt-nut-washer-overview',
    expectedAction: 'answer',
    expectedTerms: ['bolt'],
  },
];
