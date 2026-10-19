import { describe, it, expect } from 'vitest';
import { suggestBranchName } from '../src/delivery/branchName.js';

const story = { key: 'ABC-1', summary: 'Add login rate limiting', issueType: 'Story' };

describe('suggestBranchName()', () => {
  it('uses the default {type}/{KEY}-{slug} pattern', () => {
    expect(suggestBranchName(story)).toBe('feature/ABC-1-add-login-rate-limiting');
  });

  it.each([
    ['Bug', 'fix'],
    ['Defect', 'fix'],
    ['Feature', 'feature'],
    ['Improvement', 'feature'],
    ['Epic', 'feature'],
    ['Task', 'chore'],
    ['Sub-task', 'chore'],
  ])('maps issue type %s to %s', (issueType, prefix) => {
    expect(suggestBranchName({ ...story, issueType })).toMatch(new RegExp(`^${prefix}/ABC-1-`));
  });

  it('keeps at most six words', () => {
    const name = suggestBranchName({ ...story, summary: 'one two three four five six seven eight' });
    expect(name).toBe('feature/ABC-1-one-two-three-four-five-six');
  });

  it('turns non-ASCII and emoji summaries into an ASCII slug of at most 50 chars', () => {
    const name = suggestBranchName({ ...story, summary: 'Crème brûlée 🍮 API: v2 — rollout!! with a very long tail here' });
    const slug = name.replace('feature/ABC-1-', '');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.startsWith('creme-brulee-api-v2')).toBe(true);
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('never ends the slug with a dash after cutting to 50 chars', () => {
    const summary = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bb';
    const slug = suggestBranchName({ ...story, summary }).replace('feature/ABC-1-', '');
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('falls back to "task" when the summary has no letters or digits', () => {
    expect(suggestBranchName({ ...story, summary: '!!!' })).toBe('feature/ABC-1-task');
  });

  it('accepts a custom pattern', () => {
    expect(suggestBranchName(story, '{KEY}_{slug}')).toBe('ABC-1_add-login-rate-limiting');
  });
});
