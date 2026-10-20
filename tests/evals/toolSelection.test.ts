import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { connect, testDeps } from '../server/harness.js';
import { fixtureConfig } from '../helpers/jiraFixtures.js';
import { loadCases, scoreCase, summarize, toAnthropicTools, type EvalCase } from '../../evals/lib.js';

// Offline checks for the tool-selection evals (npm run eval needs an API key).

describe('toAnthropicTools()', () => {
  it('maps MCP tools to Messages API tool definitions', () => {
    const tools = toAnthropicTools([
      { name: 'jira_get_issue', description: 'Fetch', inputSchema: { type: 'object', properties: { issueKey: { type: 'string' } } } },
    ]);
    expect(tools).toEqual([
      { name: 'jira_get_issue', description: 'Fetch', input_schema: { type: 'object', properties: { issueKey: { type: 'string' } } } },
    ]);
  });
});

describe('scoreCase()', () => {
  const c: EvalCase = { id: 'x', prompt: 'p', expect: { tool: 'jira_get_issue', args: { issueKey: 'ABC-1', depth: 'full' } } };

  it('passes on the right tool with the expected arguments, ignoring extras and case', () => {
    expect(scoreCase(c, { name: 'jira_get_issue', input: { issueKey: 'abc-1', depth: 'FULL', includeConfluence: false } })).toEqual({ pass: true });
  });

  it('fails on the wrong tool, a wrong argument or no tool call', () => {
    expect(scoreCase(c, { name: 'jira_prepare_work_brief', input: { issueKey: 'ABC-1' } })).toEqual({
      pass: false,
      reason: 'called jira_prepare_work_brief, expected jira_get_issue',
    });
    expect(scoreCase(c, { name: 'jira_get_issue', input: { issueKey: 'ABC-1', depth: 'basic' } })).toEqual({
      pass: false,
      reason: 'depth was "basic", expected "full"',
    });
    expect(scoreCase(c, undefined)).toEqual({ pass: false, reason: 'no tool call' });
  });

  it('matches array arguments as sets', () => {
    const arr: EvalCase = { id: 'y', prompt: 'p', expect: { tool: 'delivery_check_changes', args: { checks: ['impact'] } } };
    expect(scoreCase(arr, { name: 'delivery_check_changes', input: { checks: ['impact'] } }).pass).toBe(true);
    expect(scoreCase(arr, { name: 'delivery_check_changes', input: { checks: ['impact', 'dod'] } }).pass).toBe(false);
  });
});

describe('summarize()', () => {
  it('reports the pass rate per tool and overall', () => {
    const summary = summarize([
      { id: 'a', tool: 'jira_get_issue', pass: true },
      { id: 'b', tool: 'jira_get_issue', pass: false, reason: 'no tool call' },
      { id: 'c', tool: 'confluence_search', pass: true },
    ]);
    expect(summary.passed).toBe(2);
    expect(summary.total).toBe(3);
    expect(summary.rate).toBeCloseTo(2 / 3);
    expect(summary.byTool).toEqual({ jira_get_issue: { passed: 1, total: 2 }, confluence_search: { passed: 1, total: 1 } });
  });
});

describe('eval cases', () => {
  const cases = loadCases();

  it('has about 30 cases with unique ids, covering every read tool', async () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    const session = await connect(testDeps({ config: fixtureConfig() }));
    try {
      const { tools } = await session.client.listTools();
      const expected = new Set(cases.map((c) => c.expect.tool));
      for (const t of tools) expect(expected.has(t.name), `no case for ${t.name}`).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('only expects tools and arguments the server declares', async () => {
    const session = await connect(testDeps({ config: fixtureConfig() }));
    try {
      const { tools } = await session.client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t]));
      for (const c of cases) {
        if (c.requiresWrites) continue; // write tools exist only with JIRA_ENABLE_WRITES=true
        const tool = byName.get(c.expect.tool);
        expect(tool, `${c.id}: unknown tool ${c.expect.tool}`).toBeDefined();
        const props = Object.keys((tool!.inputSchema as { properties?: object }).properties ?? {});
        for (const arg of Object.keys(c.expect.args ?? {})) expect(props, `${c.id}: ${arg}`).toContain(arg);
      }
    } finally {
      await session.close();
    }
  });

  it('never puts a real-looking credential or site in a prompt', () => {
    const raw = readFileSync(new URL('../../evals/cases.json', import.meta.url), 'utf8');
    expect(raw).not.toMatch(/atlassian\.net|ATATT|@[a-z]+\.(com|io)/i);
  });
});
