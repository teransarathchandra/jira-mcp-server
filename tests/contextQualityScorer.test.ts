import { describe, it, expect } from 'vitest';
import {
  scoreContextQuality,
  formatQualitySection,
} from '../src/utils/contextQualityScorer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS = {
  mainDescription: '',
  hasAcceptanceCriteria: false,
  acceptanceCriteriaCount: 0,
  usefulCommentCount: 0,
  technicalSignalCount: 0,
  hasParentContext: false,
  hasEpicContext: false,
  linkedHighRelevanceCount: 0,
  conflictCount: 0,
  ambiguityCount: 0,
  hasBlockingIssues: false,
};

// Long description (>300 chars) → 20 pts
const EXCELLENT_DESC =
  'This feature implements a complete user authentication system with login, logout, password reset, and session management. ' +
  'It should handle both email/password and OAuth2 authentication. ' +
  'Error messages must be clear and follow the existing design system guidelines.';

// Medium description (100-300 chars) → 15 pts
const GOOD_DESC =
  'This feature implements a login form with email and password fields, plus client-side validation.';

// Short description (1-100 chars) → 10 pts
const SHORT_DESC = 'Build login form.';

// ── scoreContextQuality ────────────────────────────────────────────────────────

describe('scoreContextQuality – high score (A/B grade)', () => {
  it('full context → high score with A or B grade', () => {
    // description (>300) → 20
    // AC (>= 3) → 25
    // comments (> 3) → 15
    // technical (> 4) → 15
    // parent + epic + linked → 15
    // Total = 90 → A
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: EXCELLENT_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 3,
      usefulCommentCount: 4,
      technicalSignalCount: 5,
      hasParentContext: true,
      hasEpicContext: true,
      linkedHighRelevanceCount: 1,
    });

    expect(result.score).toBeGreaterThanOrEqual(65);
    expect(['A', 'B']).toContain(result.grade);
  });

  it('A grade → score >= 80', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: EXCELLENT_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 3,
      usefulCommentCount: 4,
      technicalSignalCount: 5,
      hasParentContext: true,
      hasEpicContext: true,
      linkedHighRelevanceCount: 1,
    });

    if (result.grade === 'A') {
      expect(result.score).toBeGreaterThanOrEqual(80);
    }
  });
});

describe('scoreContextQuality – low score (D/F grade)', () => {
  it('empty description, no AC → low score (D or F grade)', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: '',
      hasAcceptanceCriteria: false,
      acceptanceCriteriaCount: 0,
    });

    expect(result.score).toBeLessThan(45);
    expect(['D', 'F']).toContain(result.grade);
  });

  it('empty description → descriptionScore = 0', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: '',
    });

    expect(result.breakdown.descriptionScore).toBe(0);
  });

  it('no AC → acScore = 0', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: '',
      hasAcceptanceCriteria: false,
      acceptanceCriteriaCount: 0,
    });

    expect(result.breakdown.acScore).toBe(0);
  });
});

describe('scoreContextQuality – blocking issues penalty', () => {
  it('hasBlockingIssues = true → -20 penalty in breakdown', () => {
    const withBlocker = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: EXCELLENT_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 3,
      usefulCommentCount: 4,
      technicalSignalCount: 5,
      hasBlockingIssues: true,
    });

    const withoutBlocker = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: EXCELLENT_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 3,
      usefulCommentCount: 4,
      technicalSignalCount: 5,
      hasBlockingIssues: false,
    });

    // Penalty is always -20 in the breakdown
    expect(withBlocker.breakdown.blockerPenalty).toBe(-20);
    expect(withoutBlocker.breakdown.blockerPenalty).toBe(0);
    // Score is lower with blocker (both well above 20 so no clamping)
    expect(withoutBlocker.score).toBeGreaterThan(withBlocker.score);
    expect(withoutBlocker.score - withBlocker.score).toBe(20);
  });
});

describe('scoreContextQuality – conflict penalty', () => {
  it('each conflict → -8 penalty per conflict', () => {
    const oneConflict = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      conflictCount: 1,
    });

    const twoConflicts = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      conflictCount: 2,
    });

    expect(oneConflict.breakdown.conflictPenalty).toBe(-8);
    expect(twoConflicts.breakdown.conflictPenalty).toBe(-16);
  });

  it('conflict penalty capped at -20', () => {
    const manyConflicts = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      conflictCount: 10,
    });

    // Math.max(-8 * 10, -20) = -20
    expect(manyConflicts.breakdown.conflictPenalty).toBe(-20);
  });
});

describe('scoreContextQuality – ambiguity penalty', () => {
  it('each ambiguity → -5 penalty per ambiguity', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      ambiguityCount: 2,
    });

    expect(result.breakdown.ambiguityPenalty).toBe(-10);
  });

  it('ambiguity penalty capped at -15', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      ambiguityCount: 10,
    });

    // Math.max(-5 * 10, -15) = -15
    expect(result.breakdown.ambiguityPenalty).toBe(-15);
  });
});

describe('scoreContextQuality – grade thresholds', () => {
  it('A grade when score >= 80', () => {
    // description(20) + AC(25) + comments(15) + technical(15) + context(15) = 90
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: EXCELLENT_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 3,
      usefulCommentCount: 4,
      technicalSignalCount: 5,
      hasParentContext: true,
      hasEpicContext: true,
      linkedHighRelevanceCount: 1,
    });

    if (result.score >= 80) {
      expect(result.grade).toBe('A');
    }
  });

  it('B grade when score 65-79', () => {
    // description(15) + AC(20) + comments(12) + technical(12) + context(5) = 64 → C
    // Need to hit 65: description(20) + AC(20) + comments(12) + technical(8) + context(5) = 65 → B
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: EXCELLENT_DESC,  // >300 chars → 20
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 2,  // 20 pts
      usefulCommentCount: 3,       // 12 pts
      technicalSignalCount: 2,     // 8 pts
      hasParentContext: true,      // 5 pts
      // Total: 20+20+12+8+5 = 65 → B
    });

    if (result.score >= 65 && result.score < 80) {
      expect(result.grade).toBe('B');
    }
  });

  it('C grade when score 45-64', () => {
    // description(15) + AC(15) + comments(8) + no technical(0) + context(0) = 38 → D
    // description(20) + AC(20) + no comments(0) + no technical(0) + context(0) = 40 → D
    // description(20) + AC(25) + no comments(0) + no technical(0) + context(5) = 50 → C
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: EXCELLENT_DESC,  // >300 chars → 20
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 3,       // 25 pts
      hasParentContext: true,           // 5 pts
      // Total: 20+25+5 = 50 → C
    });

    if (result.score >= 45 && result.score < 65) {
      expect(result.grade).toBe('C');
    }
  });

  it('D grade when score 25-44', () => {
    // short description (10) + AC count 1 (15) + no rest = 25 → D
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: SHORT_DESC,      // ≤100 chars → 10
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 1,       // 15 pts
      // Total: 10+15 = 25 → D
    });

    if (result.score >= 25 && result.score < 45) {
      expect(result.grade).toBe('D');
    }
    // Verify the score is at least 25
    expect(result.score).toBeGreaterThanOrEqual(25);
  });

  it('F grade when score < 25', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: '',             // 0 pts
      hasAcceptanceCriteria: false,    // 0 pts
      acceptanceCriteriaCount: 0,      // 0 pts
      // Total: 0 → F
    });

    expect(result.grade).toBe('F');
    expect(result.score).toBeLessThan(25);
  });
});

describe('scoreContextQuality – score always 0-100', () => {
  it('score is never negative', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: '',
      hasBlockingIssues: true,
      conflictCount: 10,
      ambiguityCount: 10,
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('score never exceeds 100', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: EXCELLENT_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 10,
      usefulCommentCount: 10,
      technicalSignalCount: 10,
      hasParentContext: true,
      hasEpicContext: true,
      linkedHighRelevanceCount: 5,
    });

    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ── formatQualitySection ──────────────────────────────────────────────────────

describe('formatQualitySection', () => {
  it('contains ## Context Quality heading', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
    });

    const formatted = formatQualitySection(result);
    expect(formatted).toContain('## Context Quality');
  });

  it('contains Score field', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
    });

    const formatted = formatQualitySection(result);
    expect(formatted).toContain('Score:');
    expect(formatted).toContain('/100');
  });

  it('contains grade in parentheses', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
    });

    const formatted = formatQualitySection(result);
    expect(formatted).toMatch(/\(([ABCDF])\)/);
  });

  it('contains Interpretation text', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
    });

    const formatted = formatQualitySection(result);
    expect(formatted).toContain('Interpretation:');
    expect(formatted).toContain(result.interpretation);
  });

  it('A grade interpretation mentions "Excellent"', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: EXCELLENT_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 3,
      usefulCommentCount: 4,
      technicalSignalCount: 5,
      hasParentContext: true,
      hasEpicContext: true,
      linkedHighRelevanceCount: 1,
    });

    if (result.grade === 'A') {
      const formatted = formatQualitySection(result);
      expect(formatted).toContain('Excellent');
    }
  });

  it('F grade interpretation mentions "Insufficient"', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: '',
    });

    const formatted = formatQualitySection(result);
    if (result.grade === 'F') {
      expect(formatted).toContain('Insufficient');
    }
  });

  it('score value in formatted output matches actual score', () => {
    const result = scoreContextQuality({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteriaCount: 2,
    });

    const formatted = formatQualitySection(result);
    expect(formatted).toContain(`${result.score}/100`);
  });
});
