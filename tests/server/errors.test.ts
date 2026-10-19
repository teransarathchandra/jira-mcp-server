import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { errorResult } from '../../src/server/errors.js';
import { JiraAuthError } from '../../src/jiraClient.js';

function textOf(r: ReturnType<typeof errorResult>): string {
  const first = r.content[0];
  return first.type === 'text' ? first.text : '';
}

describe('errorResult()', () => {
  it('marks the result as an error', () => {
    expect(errorResult(new Error('x')).isError).toBe(true);
  });

  it('maps Jira auth errors to a friendly message', () => {
    expect(textOf(errorResult(new JiraAuthError('bad token')))).toMatch(/^Authentication error:/);
  });

  it('maps Zod errors to an invalid-input message', () => {
    const parsed = z.object({ a: z.string() }).safeParse({ a: 1 });
    expect(parsed.success).toBe(false);
    expect(textOf(errorResult(parsed.error))).toMatch(/^Invalid input: a:/);
  });
});
