import { describe, it, expect } from 'vitest';
import {
  truncateText,
  dedupStrings,
  dedupByKey,
  limitArray,
  summarizeText,
  remainingBudget,
  formatTruncationWarning,
} from '../src/utils/contextBudget.js';

// ── truncateText ──────────────────────────────────────────────────────────────

describe('truncateText', () => {
  it('returns the text unchanged when it is within the limit', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('returns the text unchanged when length equals maxChars exactly', () => {
    const text = 'abcde';
    expect(truncateText(text, 5)).toBe(text);
  });

  it('truncates and appends "... [truncated]" when text exceeds maxChars', () => {
    const result = truncateText('hello world', 5);
    expect(result).toBe('hello... [truncated]');
  });

  it('slices at exactly maxChars before appending suffix', () => {
    const text = '1234567890';
    const result = truncateText(text, 4);
    expect(result).toBe('1234... [truncated]');
  });

  it('handles empty string', () => {
    expect(truncateText('', 10)).toBe('');
  });
});

// ── dedupStrings ──────────────────────────────────────────────────────────────

describe('dedupStrings', () => {
  it('removes exact duplicates', () => {
    expect(dedupStrings(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('removes duplicates case-insensitively', () => {
    expect(dedupStrings(['Apple', 'apple', 'APPLE'])).toEqual(['Apple']);
  });

  it('preserves the first occurrence casing', () => {
    const result = dedupStrings(['Hello', 'hello', 'HELLO']);
    expect(result).toEqual(['Hello']);
  });

  it('returns an empty array for empty input', () => {
    expect(dedupStrings([])).toEqual([]);
  });

  it('does not modify an array with no duplicates', () => {
    expect(dedupStrings(['alpha', 'beta', 'gamma'])).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('preserves order of first occurrences', () => {
    const result = dedupStrings(['C', 'A', 'B', 'a', 'c']);
    expect(result).toEqual(['C', 'A', 'B']);
  });
});

// ── dedupByKey ────────────────────────────────────────────────────────────────

describe('dedupByKey', () => {
  it('removes objects with duplicate keys', () => {
    const items = [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }, { id: '1', name: 'Duplicate Alice' }];
    const result = dedupByKey(items, item => item.id);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Alice');
    expect(result[1].name).toBe('Bob');
  });

  it('keeps the first occurrence when there are duplicates', () => {
    const items = [{ k: 'x', v: 1 }, { k: 'x', v: 2 }];
    const result = dedupByKey(items, item => item.k);
    expect(result).toHaveLength(1);
    expect(result[0].v).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(dedupByKey([], (x: { id: string }) => x.id)).toEqual([]);
  });

  it('returns all items when no keys are duplicated', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(dedupByKey(items, x => x.id)).toHaveLength(3);
  });

  it('works with a composite key function', () => {
    const items = [
      { type: 'bug', id: 1 },
      { type: 'bug', id: 1 },
      { type: 'feature', id: 1 },
    ];
    const result = dedupByKey(items, x => `${x.type}-${x.id}`);
    expect(result).toHaveLength(2);
  });
});

// ── limitArray ────────────────────────────────────────────────────────────────

describe('limitArray', () => {
  it('returns items unchanged and null warning when under the limit', () => {
    const { items, warning } = limitArray([1, 2, 3], 5);
    expect(items).toEqual([1, 2, 3]);
    expect(warning).toBeNull();
  });

  it('returns items unchanged and null warning when exactly at the limit', () => {
    const { items, warning } = limitArray(['a', 'b', 'c'], 3);
    expect(items).toEqual(['a', 'b', 'c']);
    expect(warning).toBeNull();
  });

  it('slices items to maxItems when over the limit', () => {
    const { items } = limitArray([1, 2, 3, 4, 5], 3);
    expect(items).toEqual([1, 2, 3]);
  });

  it('returns a non-null warning when items were dropped', () => {
    const { warning } = limitArray([1, 2, 3, 4, 5], 3);
    expect(warning).not.toBeNull();
    expect(warning).toContain('3');
    expect(warning).toContain('5');
  });

  it('returns empty array and null warning for empty input', () => {
    const { items, warning } = limitArray([], 10);
    expect(items).toEqual([]);
    expect(warning).toBeNull();
  });

  it('warning format matches "Truncated to X of Y items."', () => {
    const { warning } = limitArray([1, 2, 3, 4], 2);
    expect(warning).toBe('Truncated to 2 of 4 items.');
  });
});

// ── summarizeText ─────────────────────────────────────────────────────────────

describe('summarizeText', () => {
  it('returns text unchanged when it is within maxChars', () => {
    const text = 'Short text.';
    expect(summarizeText(text, 100)).toBe(text);
  });

  it('returns text unchanged when length equals maxChars exactly', () => {
    const text = 'abcde';
    expect(summarizeText(text, 5)).toBe(text);
  });

  it('appends "..." when text is truncated', () => {
    const text = 'This is a long text that needs to be cut down to size for the summary.';
    const result = summarizeText(text, 30);
    expect(result.endsWith('...')).toBe(true);
  });

  it('tries to end at a sentence boundary (". ")', () => {
    const text = 'First sentence. Second sentence that goes on longer than allowed.';
    const result = summarizeText(text, 30);
    // Should end at "First sentence." + "..."
    expect(result).toBe('First sentence....');
  });

  it('falls back to last space when no sentence boundary exists', () => {
    const text = 'NoSpacesAtAllUntilThisPointWhichIsVeryFarIn hello world more text here';
    const result = summarizeText(text, 40);
    expect(result.endsWith('...')).toBe(true);
    // Should not split mid-word (the character before "..." should not be inside a word)
    const withoutDots = result.slice(0, -3);
    expect(withoutDots.endsWith(' ')).toBe(false); // space is trimmed by cut
  });

  it('does a hard cut as last resort when no sentence boundary or space exists', () => {
    const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const result = summarizeText(text, 5);
    expect(result).toBe('ABCDE...');
  });
});

// ── remainingBudget ───────────────────────────────────────────────────────────

describe('remainingBudget', () => {
  it('returns positive number when under budget', () => {
    expect(remainingBudget('hello', 100)).toBe(95);
  });

  it('returns zero when exactly at budget', () => {
    expect(remainingBudget('abcde', 5)).toBe(0);
  });

  it('returns negative number when over budget', () => {
    expect(remainingBudget('hello world', 5)).toBe(-6);
  });

  it('returns maxChars for empty string', () => {
    expect(remainingBudget('', 50)).toBe(50);
  });
});

// ── formatTruncationWarning ───────────────────────────────────────────────────

describe('formatTruncationWarning', () => {
  it('returns empty string when shown equals total', () => {
    expect(formatTruncationWarning('items', 10, 10)).toBe('');
  });

  it('returns empty string when shown is greater than total', () => {
    expect(formatTruncationWarning('items', 15, 10)).toBe('');
  });

  it('returns a warning string when shown is less than total', () => {
    const result = formatTruncationWarning('linked issues', 8, 12);
    expect(result).not.toBe('');
    expect(result).toContain('8');
    expect(result).toContain('12');
    expect(result).toContain('linked issues');
  });

  it('includes the "⚠️" emoji in the warning', () => {
    const result = formatTruncationWarning('comments', 3, 10);
    expect(result).toContain('⚠️');
  });

  it('matches the exact format "⚠️ Showing X of Y Z (limit reached)."', () => {
    const result = formatTruncationWarning('linked issues', 8, 12);
    expect(result).toBe('⚠️ Showing 8 of 12 linked issues (limit reached).');
  });
});
