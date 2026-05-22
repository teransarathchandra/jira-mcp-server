import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MAX_OUTPUT_CHARS,
  MAX_SECTION_CHARS,
  fitSections,
  truncatePreservingWarnings,
  formatOmissionSummary,
  enforceFinalBudget,
} from '../src/utils/contextBudget.js';

// ── Budget constants ──────────────────────────────────────────────────────────

describe('MAX_OUTPUT_CHARS', () => {
  it('defaults to 60000 when env var is not set', () => {
    // The module-level constant is already loaded; if env var was not set at
    // module load time the default kicks in.  We verify the numeric value.
    expect(MAX_OUTPUT_CHARS).toBe(
      parseInt(process.env.MCP_MAX_OUTPUT_CHARS ?? '60000', 10)
    );
  });

  it('is a positive number', () => {
    expect(MAX_OUTPUT_CHARS).toBeGreaterThan(0);
  });
});

describe('MAX_SECTION_CHARS', () => {
  it('defaults to 12000 when env var is not set', () => {
    expect(MAX_SECTION_CHARS).toBe(
      parseInt(process.env.MCP_MAX_SECTION_CHARS ?? '12000', 10)
    );
  });

  it('is a positive number', () => {
    expect(MAX_SECTION_CHARS).toBeGreaterThan(0);
  });
});

// ── fitSections ───────────────────────────────────────────────────────────────

describe('fitSections', () => {
  it('critical section is always included even when it exceeds the budget', () => {
    const sections = [
      { content: 'A'.repeat(200), priority: 'critical' as const, label: 'critical-sec' },
    ];
    const { content, omitted } = fitSections(sections, 10);
    expect(content).toContain('A');
    expect(omitted).not.toContain('critical-sec');
  });

  it('includes high priority before medium priority', () => {
    const sections = [
      { content: 'MEDIUM', priority: 'medium' as const, label: 'med' },
      { content: 'HIGH', priority: 'high' as const, label: 'hi' },
    ];
    // Budget large enough for both.
    const { content } = fitSections(sections, 10000);
    const hiIdx = content.indexOf('HIGH');
    const medIdx = content.indexOf('MEDIUM');
    expect(hiIdx).toBeLessThan(medIdx);
  });

  it('omits a section that would exceed remaining budget (not partially included)', () => {
    const big = 'B'.repeat(500);
    const small = 'S'.repeat(50);
    const sections = [
      { content: big, priority: 'high' as const, label: 'big-section' },
      { content: small, priority: 'medium' as const, label: 'small-section' },
    ];
    // Budget just enough for small but not big.
    const { content, omitted } = fitSections(sections, 100);
    expect(content).not.toContain(big);
    expect(omitted).toContain('big-section');
  });

  it('omitted list contains labels of dropped sections', () => {
    const sections = [
      { content: 'A'.repeat(400), priority: 'high' as const, label: 'section-a' },
      { content: 'B'.repeat(400), priority: 'medium' as const, label: 'section-b' },
    ];
    const { omitted } = fitSections(sections, 450);
    expect(omitted).toContain('section-b');
    expect(omitted).not.toContain('section-a');
  });

  it('returns truncated=true when anything is omitted', () => {
    const sections = [
      { content: 'A'.repeat(300), priority: 'high' as const, label: 'sec-a' },
      { content: 'B'.repeat(300), priority: 'medium' as const, label: 'sec-b' },
    ];
    const { truncated } = fitSections(sections, 350);
    expect(truncated).toBe(true);
  });

  it('returns truncated=false when nothing is omitted', () => {
    const sections = [
      { content: 'hello', priority: 'high' as const, label: 'hi' },
      { content: 'world', priority: 'medium' as const, label: 'med' },
    ];
    const { truncated } = fitSections(sections, 10000);
    expect(truncated).toBe(false);
  });

  it('preserves within-priority order (first-in wins)', () => {
    const sections = [
      { content: 'FIRST', priority: 'high' as const, label: 'first' },
      { content: 'SECOND', priority: 'high' as const, label: 'second' },
    ];
    // Budget fits only the first.
    const { content, omitted } = fitSections(sections, 10);
    expect(content).toContain('FIRST');
    expect(omitted).toContain('second');
  });

  it('uses custom separator when provided', () => {
    const sections = [
      { content: 'AAA', priority: 'high' as const },
      { content: 'BBB', priority: 'medium' as const },
    ];
    const { content } = fitSections(sections, 10000, '---');
    expect(content).toBe('AAA---BBB');
  });

  it('returns empty content and no omissions for empty input', () => {
    const { content, omitted, truncated } = fitSections([], 1000);
    expect(content).toBe('');
    expect(omitted).toEqual([]);
    expect(truncated).toBe(false);
  });
});

// ── truncatePreservingWarnings ────────────────────────────────────────────────

describe('truncatePreservingWarnings', () => {
  it('returns content unchanged when within limit', () => {
    const content = 'Hello world\n⚠️ warning here';
    expect(truncatePreservingWarnings(content, 10000)).toBe(content);
  });

  it('preserves ⚠️ warning lines even when near limit', () => {
    const normal = 'normal line\n'.repeat(20);
    const warning = '⚠️ This is a critical warning';
    const content = normal + warning;
    const result = truncatePreservingWarnings(content, 50);
    expect(result).toContain('⚠️ This is a critical warning');
  });

  it('preserves ❌ error lines even when near limit', () => {
    const normal = 'n'.repeat(200);
    const warning = '❌ Error occurred';
    const content = normal + '\n' + warning;
    const result = truncatePreservingWarnings(content, 30);
    expect(result).toContain('❌ Error occurred');
  });

  it('preserves 🔴 critical lines even when near limit', () => {
    const normal = 'n'.repeat(200);
    const warning = '🔴 Critical issue';
    const content = normal + '\n' + warning;
    const result = truncatePreservingWarnings(content, 30);
    expect(result).toContain('🔴 Critical issue');
  });

  it('truncates non-warning content when over limit', () => {
    const longNormal = 'normal content that is very long\n'.repeat(100);
    const result = truncatePreservingWarnings(longNormal, 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('result length does not exceed maxChars', () => {
    const normal = 'abcde\n'.repeat(50);
    const warning = '⚠️ some warning\n';
    const content = normal + warning;
    const result = truncatePreservingWarnings(content, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });
});

// ── formatOmissionSummary ─────────────────────────────────────────────────────

describe('formatOmissionSummary', () => {
  it('returns empty string for empty omitted list', () => {
    expect(formatOmissionSummary([])).toBe('');
  });

  it('returns a string listing the omitted items', () => {
    const result = formatOmissionSummary(['linked issues', 'epic siblings']);
    expect(result).toContain('linked issues');
    expect(result).toContain('epic siblings');
  });

  it('includes ⚠️ in the output', () => {
    const result = formatOmissionSummary(['section-a']);
    expect(result).toContain('⚠️');
  });

  it('matches expected format for single item', () => {
    const result = formatOmissionSummary(['linked issues']);
    expect(result).toBe('⚠️ Omitted sections (budget exceeded): linked issues');
  });

  it('matches expected format for multiple items', () => {
    const result = formatOmissionSummary(['linked issues', 'epic siblings']);
    expect(result).toBe(
      '⚠️ Omitted sections (budget exceeded): linked issues, epic siblings'
    );
  });
});

// ── enforceFinalBudget ────────────────────────────────────────────────────────

describe('enforceFinalBudget', () => {
  it('returns prompt unchanged when under budget', () => {
    const prompt = 'This is a short prompt.';
    expect(enforceFinalBudget(prompt)).toBe(prompt);
  });

  it('returns prompt unchanged when exactly at budget', () => {
    // MAX_OUTPUT_CHARS is the limit; a string of that exact length should pass through.
    const prompt = 'x'.repeat(MAX_OUTPUT_CHARS);
    expect(enforceFinalBudget(prompt)).toBe(prompt);
  });

  it('truncates and adds notice when over budget', () => {
    const prompt = 'y'.repeat(MAX_OUTPUT_CHARS + 5000);
    const result = enforceFinalBudget(prompt);
    expect(result.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(result).toContain('truncated');
  });

  it('result length does not exceed MAX_OUTPUT_CHARS after enforcement', () => {
    const prompt = 'z'.repeat(MAX_OUTPUT_CHARS * 2);
    const result = enforceFinalBudget(prompt);
    expect(result.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
  });

  it('preserves warning lines after truncation', () => {
    const bigNormal = 'normal text\n'.repeat(10000);
    const warning = '⚠️ Important warning line';
    const prompt = bigNormal + warning;
    const result = enforceFinalBudget(prompt);
    expect(result).toContain('⚠️ Important warning line');
  });

  it('appends a truncation notice when prompt is over budget', () => {
    const prompt = 'a'.repeat(MAX_OUTPUT_CHARS + 1000);
    const result = enforceFinalBudget(prompt);
    expect(result).toContain('truncated');
  });
});
