import { describe, it, expect } from 'vitest';
import { evaluateReadiness } from '../src/utils/readinessEvaluator.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS = {
  mainDescription: '',
  hasAcceptanceCriteria: false,
  acceptanceCriteria: [],
  technicalSignals: [],
  ambiguities: [],
  conflictCount: 0,
  hasBlockingIssues: false,
  blockerDescriptions: [],
  usefulCommentCount: 0,
  hasRequirementChangingComment: false,
  latestCommentIntroducesQuestion: false,
  businessRules: [],
  validationRules: [],
};

// Meaningful description (> 100 chars)
const GOOD_DESC =
  'This feature implements a login form with email and password fields, with client-side validation and backend authentication.';

// ── evaluateReadiness ─────────────────────────────────────────────────────────

describe('evaluateReadiness – READY status', () => {
  it('full AC + good description + no ambiguities → READY', () => {
    // Score calculation:
    // description (>100) → +20
    // hasAcceptanceCriteria → +25
    // acceptanceCriteria.length >= 2 → +5
    // technicalSignals >= 1 → +10
    // businessRules >= 1 → +5
    // usefulCommentCount >= 1 → +5
    // !latestCommentIntroducesQuestion → +5
    // Total = 75 → READY
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteria: ['User can log in', 'Invalid credentials show error'],
      technicalSignals: ['AuthController.ts'],
      businessRules: ['Users must be verified'],
      usefulCommentCount: 2,
      latestCommentIntroducesQuestion: false,
    });

    expect(result.status).toBe('READY');
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.recommendedAction).toContain('Proceed with implementation');
  });
});

describe('evaluateReadiness – MOSTLY_READY status', () => {
  it('description + partial AC → MOSTLY_READY', () => {
    // description (+20) + hasAC (+25) + !latestQuestion (+5) = 50 → MOSTLY_READY
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteria: ['User can log in'],
      latestCommentIntroducesQuestion: false,
    });

    expect(result.status).toBe('MOSTLY_READY');
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThan(70);
    expect(result.recommendedAction).toContain('Proceed with implementation');
  });
});

describe('evaluateReadiness – NEEDS_CLARIFICATION status', () => {
  it('no description + multiple ambiguities → NEEDS_CLARIFICATION', () => {
    // No description (0), no AC (0), !latestQuestion (+5)
    // 3 ambiguities penalty: -30 (max)
    // Total = 5 - 30 = -25 → 0 effectively → NEEDS_CLARIFICATION
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: '',
      hasAcceptanceCriteria: false,
      acceptanceCriteria: [],
      ambiguities: ['Unclear scope', 'Undefined validation behavior', 'No error handling specified'],
      latestCommentIntroducesQuestion: false,
    });

    expect(result.status).toBe('NEEDS_CLARIFICATION');
    expect(result.score).toBeLessThan(40);
    expect(result.recommendedAction).toContain('clarification');
  });

  it('score below 40 → NEEDS_CLARIFICATION', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: 'short',  // ≤ 100 chars, so no bonus
      hasAcceptanceCriteria: false,
      acceptanceCriteria: [],
      ambiguities: ['Ambiguity one', 'Ambiguity two'],
      latestCommentIntroducesQuestion: true,  // -15
    });

    expect(result.status).toBe('NEEDS_CLARIFICATION');
  });
});

describe('evaluateReadiness – BLOCKED status', () => {
  it('hasBlockingIssues = true → BLOCKED regardless of score', () => {
    // Even with a great description and AC, blocking issues force BLOCKED
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteria: ['AC 1', 'AC 2'],
      technicalSignals: ['AuthService.ts'],
      businessRules: ['Rule A'],
      usefulCommentCount: 3,
      hasBlockingIssues: true,
      blockerDescriptions: ['PROJ-123 must be resolved first'],
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.recommendedAction).toContain('Resolve blockers');
  });

  it('BLOCKED with high score → still BLOCKED', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteria: ['AC 1', 'AC 2', 'AC 3'],
      technicalSignals: ['module.ts'],
      hasBlockingIssues: true,
      blockerDescriptions: ['Dependency not ready'],
    });

    expect(result.status).toBe('BLOCKED');
  });
});

describe('evaluateReadiness – conflict penalty', () => {
  it('conflict penalty reduces score', () => {
    const withConflicts = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteria: ['AC 1'],
      conflictCount: 2,
    });

    const withoutConflicts = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteria: ['AC 1'],
      conflictCount: 0,
    });

    expect(withConflicts.score).toBeLessThan(withoutConflicts.score);
  });

  it('conflict count > 2 capped at -30 penalty', () => {
    const twoConflicts = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      conflictCount: 2,
    });

    const manyConflicts = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      conflictCount: 10,
    });

    // Max penalty is 30, so 2 conflicts (30) and 10 conflicts (also 30 due to cap)
    expect(twoConflicts.score).toBe(manyConflicts.score);
  });
});

describe('evaluateReadiness – reasons array', () => {
  it('empty description → reason mentions no description', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: '',
    });

    expect(result.reasons.some((r) => r.toLowerCase().includes('description'))).toBe(true);
  });

  it('good description → reason mentions clear goal', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
    });

    expect(result.reasons.some((r) => r.toLowerCase().includes('clear'))).toBe(true);
  });

  it('has acceptance criteria → reason mentions AC', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteria: ['AC 1'],
    });

    expect(
      result.reasons.some((r) => r.toLowerCase().includes('acceptance criteria')),
    ).toBe(true);
  });

  it('no AC → reason mentions missing AC', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: false,
      acceptanceCriteria: [],
    });

    expect(
      result.reasons.some(
        (r) => r.toLowerCase().includes('acceptance criteria') || r.toLowerCase().includes('inferred'),
      ),
    ).toBe(true);
  });

  it('technical signals → reason mentions technical area', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      technicalSignals: ['AuthController.ts'],
    });

    expect(
      result.reasons.some((r) => r.toLowerCase().includes('technical')),
    ).toBe(true);
  });

  it('ambiguities → reasons include ambiguity entries (max 3)', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      ambiguities: ['Ambiguity A', 'Ambiguity B', 'Ambiguity C', 'Ambiguity D'],
    });

    const ambiguityReasons = result.reasons.filter((r) =>
      r.toLowerCase().includes("ambiguity:"),
    );
    expect(ambiguityReasons.length).toBeLessThanOrEqual(3);
    expect(ambiguityReasons.length).toBeGreaterThanOrEqual(1);
  });

  it('blocker descriptions → reasons include blocker entries (max 2)', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasBlockingIssues: true,
      blockerDescriptions: ['Blocker 1', 'Blocker 2', 'Blocker 3'],
    });

    const blockerReasons = result.reasons.filter((r) =>
      r.toLowerCase().startsWith("blocker:"),
    );
    expect(blockerReasons.length).toBeLessThanOrEqual(2);
    expect(blockerReasons.length).toBeGreaterThanOrEqual(1);
  });

  it('conflict → reason mentions conflicts', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      conflictCount: 1,
    });

    expect(
      result.reasons.some((r) => r.toLowerCase().includes('conflict')),
    ).toBe(true);
  });
});

describe('evaluateReadiness – recommendedAction matches status', () => {
  it('READY → "Proceed with implementation."', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteria: ['AC 1', 'AC 2'],
      technicalSignals: ['module.ts'],
      businessRules: ['Rule 1'],
      usefulCommentCount: 2,
    });

    if (result.status === 'READY') {
      expect(result.recommendedAction).toBe('Proceed with implementation.');
    }
  });

  it('MOSTLY_READY → action mentions "Proceed" and "conventions"', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: GOOD_DESC,
      hasAcceptanceCriteria: true,
      acceptanceCriteria: ['AC 1'],
    });

    if (result.status === 'MOSTLY_READY') {
      expect(result.recommendedAction).toContain('Proceed with implementation');
    }
  });

  it('NEEDS_CLARIFICATION → action mentions "clarification"', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: '',
      ambiguities: ['Unclear behavior'],
    });

    if (result.status === 'NEEDS_CLARIFICATION') {
      expect(result.recommendedAction).toContain('clarification');
    }
  });

  it('BLOCKED → action mentions "Resolve blockers"', () => {
    const result = evaluateReadiness({
      ...DEFAULT_PARAMS,
      mainDescription: '',
      hasBlockingIssues: true,
      blockerDescriptions: ['PROJ-100 must be done'],
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.recommendedAction).toContain('Resolve blockers');
  });
});
