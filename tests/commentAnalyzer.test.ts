import { describe, it, expect } from 'vitest';
import {
  isUsefulComment,
  extractRequirementSignals,
  summarizeUsefulComments,
  type JiraCommentInput,
} from '../src/utils/commentAnalyzer.js';

// ── isUsefulComment ────────────────────────────────────────────────────────────

describe('isUsefulComment – noise filtering', () => {
  it('returns false for "done" (exact noise phrase)', () => {
    expect(isUsefulComment('done')).toBe(false);
  });

  it('returns false for "ok" (exact noise phrase)', () => {
    expect(isUsefulComment('ok')).toBe(false);
  });

  it('returns false for "fixed" (exact noise phrase)', () => {
    expect(isUsefulComment('fixed')).toBe(false);
  });

  it('returns false for "lgtm" (exact noise phrase)', () => {
    expect(isUsefulComment('lgtm')).toBe(false);
  });

  it('returns false for very short text (< 15 chars)', () => {
    expect(isUsefulComment('hi')).toBe(false);
    expect(isUsefulComment('see you')).toBe(false);
  });

  it('returns false for automated comment containing "status changed to"', () => {
    expect(isUsefulComment('Status changed to In Progress by automation.')).toBe(false);
  });

  it('returns false for automated comment containing "automatically transitioned"', () => {
    expect(isUsefulComment('Issue automatically transitioned to Done.')).toBe(false);
  });

  it('returns false for automated comment containing "jenkins"', () => {
    expect(isUsefulComment('Jenkins build #42 passed.')).toBe(false);
  });

  it('returns false for a pure @mention', () => {
    expect(isUsefulComment('@johndoe')).toBe(false);
  });
});

describe('isUsefulComment – useful signals', () => {
  it('returns true for text containing "acceptance criteria"', () => {
    expect(isUsefulComment('Acceptance criteria: user can log in.')).toBe(true);
  });

  it('returns true for text containing "should"', () => {
    expect(isUsefulComment('The form should validate email format.')).toBe(true);
  });

  it('returns true for text containing "must"', () => {
    expect(isUsefulComment('User must be authenticated to proceed.')).toBe(true);
  });

  it('returns true for text containing "validate"', () => {
    expect(isUsefulComment('We need to validate the input data.')).toBe(true);
  });

  it('returns true for long comments (> 100 chars) even without keywords', () => {
    const longText = 'This is a fairly generic comment without any known keywords but it is definitely longer than one hundred characters in total.';
    expect(longText.length).toBeGreaterThan(100);
    expect(isUsefulComment(longText)).toBe(true);
  });

  it('returns true for comment with "edge case"', () => {
    expect(isUsefulComment('Make sure to handle the edge case where input is null.')).toBe(true);
  });

  it('returns true for comment with "business rule"', () => {
    expect(isUsefulComment('Apply the business rule for discount calculation here.')).toBe(true);
  });
});

// ── extractRequirementSignals ──────────────────────────────────────────────────

describe('extractRequirementSignals', () => {
  it('returns acceptance_criteria signal when text contains "acceptance criteria"', () => {
    const signals = extractRequirementSignals('Acceptance criteria: user must be logged in.');
    const types = signals.map(s => s.type);
    expect(types).toContain('acceptance_criteria');
  });

  it('returns bug signal when text contains "error"', () => {
    const signals = extractRequirementSignals('There is an error when submitting the form.');
    const types = signals.map(s => s.type);
    expect(types).toContain('bug');
  });

  it('returns edge_case signal when text contains "edge case"', () => {
    const signals = extractRequirementSignals('Consider the edge case with empty input.');
    const types = signals.map(s => s.type);
    expect(types).toContain('edge_case');
  });

  it('returns validation signal when text contains "validate"', () => {
    const signals = extractRequirementSignals('We must validate the phone number format.');
    const types = signals.map(s => s.type);
    expect(types).toContain('validation');
  });

  it('returns business_rule signal when text contains "business rule"', () => {
    const signals = extractRequirementSignals('This business rule must be enforced.');
    const types = signals.map(s => s.type);
    expect(types).toContain('business_rule');
  });

  it('returns api_behavior signal when text contains "api"', () => {
    const signals = extractRequirementSignals('The API should return a 200 status.');
    const types = signals.map(s => s.type);
    expect(types).toContain('api_behavior');
  });

  it('returns ui_behavior signal when text contains "button"', () => {
    const signals = extractRequirementSignals('The submit button should be disabled after click.');
    const types = signals.map(s => s.type);
    expect(types).toContain('ui_behavior');
  });

  it('returns blocker signal when text contains "blocker"', () => {
    const signals = extractRequirementSignals('This is a blocker for the release.');
    const types = signals.map(s => s.type);
    expect(types).toContain('blocker');
  });

  it('returns clarification signal when text contains "unclear"', () => {
    const signals = extractRequirementSignals('The requirements are still unclear.');
    const types = signals.map(s => s.type);
    expect(types).toContain('clarification');
  });

  it('returns implementation_hint signal when text contains "suggest"', () => {
    const signals = extractRequirementSignals('I suggest using a debounce here.');
    const types = signals.map(s => s.type);
    expect(types).toContain('implementation_hint');
  });

  it('returns test_expectation signal when text contains "test"', () => {
    const signals = extractRequirementSignals('Add a unit test for this function.');
    const types = signals.map(s => s.type);
    expect(types).toContain('test_expectation');
  });

  it('returns requirement_change signal when text contains "instead"', () => {
    const signals = extractRequirementSignals('Use a modal instead of a full page redirect.');
    const types = signals.map(s => s.type);
    expect(types).toContain('requirement_change');
  });

  it('returns empty array for noisy, short, or irrelevant text', () => {
    // Text long enough to pass length check but no signal keywords
    const signals = extractRequirementSignals('Everything looks fine and nothing is wrong here at all, no keywords present.');
    // No known signal patterns should match
    expect(signals.length).toBe(0);
  });

  it('does not return duplicate signal types for repeated patterns', () => {
    const signals = extractRequirementSignals('The api endpoint returns a 404. The rest api also fails.');
    const types = signals.map(s => s.type);
    const uniqueTypes = [...new Set(types)];
    expect(types.length).toBe(uniqueTypes.length);
  });

  it('each signal has an excerpt property', () => {
    const signals = extractRequirementSignals('There is a bug in the validation logic.');
    for (const signal of signals) {
      expect(typeof signal.excerpt).toBe('string');
      expect(signal.excerpt.length).toBeGreaterThan(0);
    }
  });
});

// ── summarizeUsefulComments ───────────────────────────────────────────────────

describe('summarizeUsefulComments', () => {
  const makeComment = (
    id: string,
    author: string,
    body: string,
    created: string,
  ): JiraCommentInput => ({ id, author, body, created, updated: created });

  it('returns fallback message for empty comment array', () => {
    expect(summarizeUsefulComments([])).toBe('No requirement-related comments found.');
  });

  it('returns fallback message when all comments are noise', () => {
    const comments = [
      makeComment('1', 'Alice', 'done', '2024-01-01T10:00:00.000Z'),
      makeComment('2', 'Bob', 'ok', '2024-01-02T10:00:00.000Z'),
      makeComment('3', 'Carol', 'fixed', '2024-01-03T10:00:00.000Z'),
    ];
    expect(summarizeUsefulComments(comments)).toBe('No requirement-related comments found.');
  });

  it('filters out noise and includes only useful comments', () => {
    const comments = [
      makeComment('1', 'Alice', 'done', '2024-01-01T10:00:00.000Z'),
      makeComment('2', 'Bob', 'The form should validate email addresses properly.', '2024-01-02T10:00:00.000Z'),
    ];
    const result = summarizeUsefulComments(comments);
    expect(result).toContain('Bob');
    expect(result).not.toContain('Alice');
  });

  it('sorts comments by date — newest first', () => {
    const comments = [
      makeComment('1', 'OldAuthor', 'Acceptance criteria: user must log in.', '2023-01-01T10:00:00.000Z'),
      makeComment('2', 'NewAuthor', 'We must also validate the password strength.', '2024-06-01T10:00:00.000Z'),
    ];
    const result = summarizeUsefulComments(comments);
    const oldIdx = result.indexOf('OldAuthor');
    const newIdx = result.indexOf('NewAuthor');
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it('formats output with date and author', () => {
    const comments = [
      makeComment('1', 'DevUser', 'The API should return HTTP 422 for validation errors.', '2024-03-15T08:00:00.000Z'),
    ];
    const result = summarizeUsefulComments(comments);
    expect(result).toContain('2024-03-15');
    expect(result).toContain('DevUser');
  });

  it('includes signal types in the output when signals are found', () => {
    const comments = [
      makeComment('1', 'PM', 'Acceptance criteria: clicking submit must trigger validation.', '2024-04-01T00:00:00.000Z'),
    ];
    const result = summarizeUsefulComments(comments);
    expect(result).toContain('Signals:');
    expect(result).toContain('acceptance_criteria');
  });

  it('limits output to a maximum of 10 comments', () => {
    const comments: JiraCommentInput[] = [];
    for (let i = 1; i <= 15; i++) {
      comments.push(
        makeComment(
          String(i),
          `Author${i}`,
          `The form should validate field ${i} on submission properly and thoroughly.`,
          `2024-01-${String(i).padStart(2, '0')}T00:00:00.000Z`,
        ),
      );
    }
    const result = summarizeUsefulComments(comments);
    // Count occurrences of "Author" to check how many entries appear
    const matches = result.match(/\*\*\[/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(10);
  });
});
