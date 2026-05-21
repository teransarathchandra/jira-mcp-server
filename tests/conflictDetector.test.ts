import { describe, it, expect } from 'vitest';
import { detectConflicts, formatConflicts } from '../src/utils/conflictDetector.js';

// ── detectConflicts ────────────────────────────────────────────────────────────

describe('detectConflicts – no conflicts', () => {
  it('returns no conflicts with a single source', () => {
    const result = detectConflicts([
      { label: 'description', text: 'User can submit the form.' },
    ]);
    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns no conflict when both sources say "show warning"', () => {
    const result = detectConflicts([
      { label: 'description', text: 'The form should show warning when input is invalid.' },
      { label: 'comment', text: 'Make sure to show warning to the user on bad input.' },
    ]);
    // Same behavior on both sides — no conflict
    const behaviorConflicts = result.conflicts.filter(c => c.type === 'behavior_conflict');
    expect(behaviorConflicts).toHaveLength(0);
  });
});

describe('detectConflicts – behavior conflicts', () => {
  it('detects behavior conflict: "show warning" vs "block submission"', () => {
    const result = detectConflicts([
      { label: 'description', text: 'On invalid input, show warning to the user.' },
      { label: 'comment (2024-01-20)', text: 'We should block submission when validation fails.' },
    ]);
    expect(result.hasConflicts).toBe(true);
    const conflict = result.conflicts.find(c => c.type === 'behavior_conflict');
    expect(conflict).toBeDefined();
    expect(conflict!.description).toMatch(/show warning/i);
  });

  it('detects behavior conflict: "allow" vs "reject"', () => {
    const result = detectConflicts([
      { label: 'spec', text: 'Allow the user to submit without an email.' },
      { label: 'comment', text: 'We should reject submissions that have no email.' },
    ]);
    const conflict = result.conflicts.find(c => c.type === 'behavior_conflict');
    expect(conflict).toBeDefined();
  });

  it('detects behavior conflict when sides are reversed (B has sideA, A has sideB)', () => {
    const result = detectConflicts([
      { label: 'description', text: 'The form must block submission on errors.' },
      { label: 'comment', text: 'Actually just show warning instead of blocking.' },
    ]);
    expect(result.hasConflicts).toBe(true);
  });
});

describe('detectConflicts – audience conflicts', () => {
  it('detects audience conflict: "admin only" vs "all users"', () => {
    const result = detectConflicts([
      { label: 'description', text: 'This feature is for admins only.' },
      { label: 'comment', text: 'All users should be able to access this.' },
    ]);
    expect(result.hasConflicts).toBe(true);
    const conflict = result.conflicts.find(c => c.type === 'audience_conflict');
    expect(conflict).toBeDefined();
    expect(conflict!.severity).toBe('high');
  });

  it('detects audience conflict: "authenticated users" vs "anonymous"', () => {
    const result = detectConflicts([
      { label: 'spec', text: 'Only authenticated users can see this page.' },
      { label: 'requirement', text: 'Anonymous access should be allowed.' },
    ]);
    const conflict = result.conflicts.find(c => c.type === 'audience_conflict');
    expect(conflict).toBeDefined();
  });
});

describe('detectConflicts – requirement change', () => {
  it('detects requirement change when later source contains "instead"', () => {
    const result = detectConflicts([
      { label: 'description', text: 'Show a modal dialog on error.' },
      { label: 'comment (2024-02-01)', text: 'Use an inline message instead of a modal.' },
    ]);
    const change = result.conflicts.find(c => c.type === 'requirement_change');
    expect(change).toBeDefined();
    expect(change!.severity).toBe('high');
  });

  it('detects requirement change when later source contains "actually"', () => {
    const result = detectConflicts([
      { label: 'description', text: 'The button should be green.' },
      { label: 'comment', text: 'Actually the button should be red per the new design.' },
    ]);
    const change = result.conflicts.find(c => c.type === 'requirement_change');
    expect(change).toBeDefined();
  });

  it('labels source2 as the later (overriding) source', () => {
    const result = detectConflicts([
      { label: 'original spec', text: 'Redirect after submission.' },
      { label: 'PM comment', text: 'Actually keep the user on the same page.' },
    ]);
    const change = result.conflicts.find(c => c.type === 'requirement_change');
    expect(change!.source2).toContain('PM comment');
    expect(change!.source1).toContain('original spec');
  });
});

describe('detectConflicts – deduplication', () => {
  it('does not return the same conflict pair twice', () => {
    // Both sources trigger the same behavior pair
    const result = detectConflicts([
      { label: 'spec', text: 'show warning on error.' },
      { label: 'comment', text: 'block submission on error.' },
    ]);
    const behaviorConflicts = result.conflicts.filter(c => c.type === 'behavior_conflict');
    // Check there are no duplicate source pairs
    const keys = behaviorConflicts.map(c => [c.source1, c.source2].sort().join('|'));
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });
});

describe('detectConflicts – chronological order', () => {
  it('treats sources in input order (index 0 = oldest, last = newest)', () => {
    const result = detectConflicts([
      { label: 'old spec', date: '2024-01-01', text: 'Feature X should show warning.' },
      { label: 'new comment', date: '2024-06-01', text: 'Actually block submission instead.' },
    ]);
    // j > i, so new comment is source2
    const change = result.conflicts.find(c => c.type === 'requirement_change');
    expect(change?.source2).toContain('new comment');
  });
});

// ── formatConflicts ────────────────────────────────────────────────────────────

describe('formatConflicts', () => {
  it('returns empty string when there are no conflicts', () => {
    const result = detectConflicts([
      { label: 'description', text: 'User can log in.' },
    ]);
    expect(formatConflicts(result)).toBe('');
  });

  it('returns empty string for explicitly empty conflicts object', () => {
    expect(formatConflicts({ hasConflicts: false, conflicts: [] })).toBe('');
  });

  it('returns formatted output starting with the warning header', () => {
    const result = detectConflicts([
      { label: 'description', text: 'This is for admins only.' },
      { label: 'comment', text: 'All users can access this.' },
    ]);
    const formatted = formatConflicts(result);
    expect(formatted).toContain('⚠️');
    expect(formatted).toContain('Potential Conflicts Detected');
  });

  it('returns a bullet list item for each conflict', () => {
    const result = detectConflicts([
      { label: 'description', text: 'This is for admins only.' },
      { label: 'comment', text: 'All users can access this.' },
    ]);
    const formatted = formatConflicts(result);
    const bullets = formatted.split('\n').filter(l => l.startsWith('-'));
    expect(bullets.length).toBeGreaterThanOrEqual(1);
  });

  it('includes severity in formatted output', () => {
    const result = detectConflicts([
      { label: 'description', text: 'This is for admins only.' },
      { label: 'comment', text: 'All users can access this.' },
    ]);
    const formatted = formatConflicts(result);
    expect(formatted).toMatch(/\[high\]|\[medium\]|\[low\]/);
  });

  it('includes source labels in formatted output', () => {
    const result = detectConflicts([
      { label: 'task description', text: 'show warning on validation failure.' },
      { label: 'user comment', text: 'block submission on validation failure.' },
    ]);
    const formatted = formatConflicts(result);
    expect(formatted).toContain('task description');
    expect(formatted).toContain('user comment');
  });
});
