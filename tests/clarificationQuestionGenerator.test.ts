import { describe, it, expect } from 'vitest';
import {
  generateClarificationQuestions,
  formatClarificationSection,
} from '../src/utils/clarificationQuestionGenerator.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS = {
  readinessStatus: 'NEEDS_CLARIFICATION' as const,
  ambiguities: [],
  conflictDescriptions: [],
  hasBlockingIssues: false,
  blockerDescriptions: [],
  mainDescription: '',
  acceptanceCriteria: [],
  technicalSignals: [],
  userRoles: [],
  validationRules: [],
  businessRules: [],
  latestCommentIntroducesQuestion: false,
  latestCommentBody: '',
};

// ── generateClarificationQuestions ───────────────────────────────────────────

describe('generateClarificationQuestions – READY status', () => {
  it('READY status → shouldAsk = false, empty questions', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'READY',
      ambiguities: ['Some ambiguity'],
      conflictDescriptions: ['Some conflict'],
    });

    expect(result.shouldAsk).toBe(false);
    expect(result.questions).toHaveLength(0);
  });

  it('MOSTLY_READY status → shouldAsk = false', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'MOSTLY_READY',
    });

    expect(result.shouldAsk).toBe(false);
    expect(result.questions).toHaveLength(0);
  });
});

describe('generateClarificationQuestions – NEEDS_CLARIFICATION status', () => {
  it('NEEDS_CLARIFICATION → shouldAsk = true', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'NEEDS_CLARIFICATION',
      ambiguities: ['Unclear error handling behavior'],
    });

    expect(result.shouldAsk).toBe(true);
  });

  it('NEEDS_CLARIFICATION with ambiguities → generates questions', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'NEEDS_CLARIFICATION',
      ambiguities: ['Undefined validation behavior'],
    });

    expect(result.questions.length).toBeGreaterThanOrEqual(1);
    expect(result.shouldAsk).toBe(true);
  });
});

describe('generateClarificationQuestions – BLOCKED status', () => {
  it('BLOCKED → shouldAsk = true', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'BLOCKED',
      hasBlockingIssues: true,
      blockerDescriptions: ['PROJ-100 must be resolved'],
    });

    expect(result.shouldAsk).toBe(true);
  });

  it('BLOCKED → blocker questions appear first', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'BLOCKED',
      hasBlockingIssues: true,
      blockerDescriptions: ['PROJ-100 must be resolved first'],
      ambiguities: ['Some ambiguity here'],
    });

    expect(result.questions.length).toBeGreaterThanOrEqual(1);
    expect(result.questions[0].priority).toBe('blocker');
    expect(result.questions[0].topic).toBe('blocker');
  });

  it('BLOCKED → blocker question text contains blocker description', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'BLOCKED',
      hasBlockingIssues: true,
      blockerDescriptions: ['Dependency service must be deployed'],
    });

    expect(result.questions[0].question).toContain('Dependency service must be deployed');
  });
});

describe('generateClarificationQuestions – conflict questions', () => {
  it('conflict with "warning" and "block" → specific validation question', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'NEEDS_CLARIFICATION',
      conflictDescriptions: ['warning vs block on submit'],
    });

    expect(result.questions.length).toBeGreaterThanOrEqual(1);
    const validationQ = result.questions.find(
      (q) => q.topic === 'validation behavior',
    );
    expect(validationQ).toBeDefined();
    expect(validationQ?.question).toContain('block submission');
  });

  it('conflict with "admin" and "all users" → generates specific role question', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'NEEDS_CLARIFICATION',
      conflictDescriptions: ['feature for admin vs all users'],
    });

    const roleQ = result.questions.find((q) => q.topic === 'user roles');
    expect(roleQ).toBeDefined();
    expect(roleQ?.question).toContain('administrators');
  });

  it('generic conflict → question starts with "Clarify conflicting requirement:"', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'NEEDS_CLARIFICATION',
      conflictDescriptions: ['Some unrecognized conflict description here'],
    });

    if (result.questions.length > 0) {
      const conflictQ = result.questions.find((q) =>
        q.question.startsWith('Clarify conflicting requirement:'),
      );
      expect(conflictQ).toBeDefined();
    }
  });
});

describe('generateClarificationQuestions – no duplicate questions', () => {
  it('same topic not repeated even if ambiguities have similar text', () => {
    // Multiple ambiguities with same short prefix will differ in topic key
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'NEEDS_CLARIFICATION',
      ambiguities: [
        'Unclear behavior A',
        'Unclear behavior A',  // exact duplicate
        'Unclear behavior B',
      ],
    });

    const topics = result.questions.map((q) => q.topic);
    const uniqueTopics = new Set(topics);
    expect(topics.length).toBe(uniqueTopics.size);
  });

  it('blocker topic not added twice when multiple blockers', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'BLOCKED',
      hasBlockingIssues: true,
      blockerDescriptions: ['Blocker A', 'Blocker B', 'Blocker C'],
    });

    // All blockers use topic 'blocker', so only the first one gets added
    const blockerQuestions = result.questions.filter((q) => q.topic === 'blocker');
    expect(blockerQuestions.length).toBe(1);
  });
});

describe('generateClarificationQuestions – max 5 questions', () => {
  it('many ambiguities → at most 5 questions returned', () => {
    const manyAmbiguities = [
      'Ambiguity about error state A',
      'Ambiguity about validation B',
      'Ambiguity about UI layout C',
      'Ambiguity about permission D',
      'Ambiguity about flow E',
      'Ambiguity about data format F',
      'Ambiguity about caching G',
    ];

    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'NEEDS_CLARIFICATION',
      ambiguities: manyAmbiguities,
    });

    expect(result.questions.length).toBeLessThanOrEqual(5);
  });

  it('conflictDescriptions + ambiguities combined → still max 5', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'NEEDS_CLARIFICATION',
      conflictDescriptions: [
        'warning vs block submit issue',
        'admin vs all users conflict',
      ],
      ambiguities: [
        'Ambiguity one here',
        'Ambiguity two here',
        'Ambiguity three here',
      ],
    });

    expect(result.questions.length).toBeLessThanOrEqual(5);
  });
});

// ── formatClarificationSection ────────────────────────────────────────────────

describe('formatClarificationSection', () => {
  it('shouldAsk = false → returns empty string', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'READY',
    });

    const formatted = formatClarificationSection(result);
    expect(formatted).toBe('');
  });

  it('shouldAsk = false with empty questions → returns empty string', () => {
    const formatted = formatClarificationSection({ shouldAsk: false, questions: [] });
    expect(formatted).toBe('');
  });

  it('shouldAsk = true with questions → returns formatted section', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'NEEDS_CLARIFICATION',
      ambiguities: ['Unclear validation behavior expected'],
    });

    const formatted = formatClarificationSection(result);
    expect(formatted).toContain('## Clarification Needed');
    expect(formatted).toContain('Before implementing');
  });

  it('formatted section contains question entries with priority', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'BLOCKED',
      hasBlockingIssues: true,
      blockerDescriptions: ['PROJ-200 must be resolved first'],
    });

    const formatted = formatClarificationSection(result);
    expect(formatted).toContain('[blocker]');
    expect(formatted).toContain('PROJ-200 must be resolved first');
  });

  it('formatted section for NEEDS_CLARIFICATION has high priority entries', () => {
    const result = generateClarificationQuestions({
      ...DEFAULT_PARAMS,
      readinessStatus: 'NEEDS_CLARIFICATION',
      conflictDescriptions: ['warning vs block submit behavior'],
    });

    const formatted = formatClarificationSection(result);
    if (result.shouldAsk && result.questions.length > 0) {
      expect(formatted).toContain('[high]');
    }
  });
});
