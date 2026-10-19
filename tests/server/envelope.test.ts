import { describe, it, expect } from 'vitest';
import { EnvelopeSchema, toolResult } from '../../src/server/envelope.js';

describe('toolResult()', () => {
  it('wraps markdown in a v2 envelope', () => {
    const r = toolResult('jira_get_issue', '# Hi', { issueKey: 'ABC-1' });
    expect(r.structuredContent).toEqual({
      schemaVersion: '2.0',
      tool: 'jira_get_issue',
      issueKey: 'ABC-1',
      markdown: '# Hi',
      warnings: [],
    });
  });

  it('mirrors the markdown as the text content', () => {
    const r = toolResult('jira_get_issue', '# Hi');
    expect(r.content).toEqual([{ type: 'text', text: '# Hi' }]);
  });

  it('produces an envelope that satisfies EnvelopeSchema', () => {
    const r = toolResult('jira_search_issues', 'x', { warnings: ['w'] });
    expect(() => EnvelopeSchema.parse(r.structuredContent)).not.toThrow();
  });

  it('omits issueKey when not provided', () => {
    const r = toolResult('jira_search_issues', 'x');
    expect(r.structuredContent).not.toHaveProperty('issueKey');
  });
});
