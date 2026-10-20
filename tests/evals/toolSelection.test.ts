import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { connect, testDeps } from '../server/harness.js';
import { fixtureConfig } from '../helpers/jiraFixtures.js';
import {
  claudeCodeArgs,
  evalRunner,
  firstTurnToolCalls,
  loadCases,
  scoreCase,
  summarize,
  toAnthropicTools,
  type EvalCase,
} from '../../evals/lib.js';

// Offline checks for the tool-selection evals (npm run eval calls a model).

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

  it('passes when the expected tool is among parallel calls in the first turn', () => {
    const calls = [
      { name: 'jira_search_issues', input: {} },
      { name: 'jira_get_issue', input: { issueKey: 'ABC-1', depth: 'full' } },
    ];
    expect(scoreCase(c, calls)).toEqual({ pass: true });
  });

  it('reports the first call when none of the parallel calls is the expected tool', () => {
    expect(scoreCase(c, [{ name: 'confluence_search', input: {} }, { name: 'jira_search_issues', input: {} }])).toEqual({
      pass: false,
      reason: 'called confluence_search, expected jira_get_issue',
    });
    expect(scoreCase(c, [])).toEqual({ pass: false, reason: 'no tool call' });
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

describe('evalRunner()', () => {
  it('uses the Anthropic API when a key is set, otherwise Claude Code', () => {
    expect(evalRunner({ ANTHROPIC_API_KEY: 'k' })).toEqual({ runner: 'api' });
    expect(evalRunner({})).toEqual({ runner: 'claude-code' });
  });

  it('honours EVAL_RUNNER', () => {
    expect(evalRunner({ ANTHROPIC_API_KEY: 'k', EVAL_RUNNER: 'claude-code' })).toEqual({ runner: 'claude-code' });
  });

  it('fails the run when the API runner has no key, instead of skipping green', () => {
    expect(evalRunner({ EVAL_RUNNER: 'api' }).error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('rejects an unknown runner', () => {
    expect(evalRunner({ EVAL_RUNNER: 'gpt' }).error).toMatch(/EVAL_RUNNER/);
  });
});

describe('claudeCodeArgs()', () => {
  const args = claudeCodeArgs({ prompt: 'Start ABC-1', mcpConfigPath: '/tmp/mcp.json', model: 'claude-haiku-5-5' });

  it('loads only this server, with no built-in tools and no user settings', () => {
    expect(args.slice(0, 2)).toEqual(['-p', 'Start ABC-1']);
    expect(args).toContain('--strict-mcp-config');
    expect(args.join(' ')).toContain('--mcp-config /tmp/mcp.json');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
  });

  it('streams JSON, stops after one turn and keeps no session', () => {
    expect(args.join(' ')).toContain('--output-format stream-json --verbose');
    expect(args.join(' ')).toContain('--max-turns 1');
    expect(args).toContain('--no-session-persistence');
    expect(args.join(' ')).toContain('--model claude-haiku-5-5');
  });
});

describe('firstTurnToolCalls()', () => {
  const line = (o: object) => JSON.stringify(o);
  // Claude Code streams each content block of a turn as its own assistant event, sharing the message id.
  const block = (id: string, content: object) => line({ type: 'assistant', message: { id, content: [content] } });
  const use = (id: string, name: string, input: object = {}) => block(id, { type: 'tool_use', name, input });

  it('returns every tool call of the first turn with the server prefix removed', () => {
    const stream = [
      line({ type: 'system', subtype: 'init' }),
      block('m1', { type: 'text', text: 'Let me look.' }),
      use('m1', 'mcp__jira-delivery__jira_get_issue', { issueKey: 'ABC-1' }),
      use('m1', 'mcp__jira-delivery__jira_prepare_work_brief', { issueKey: 'ABC-1' }),
      line({ type: 'user', message: { content: [] } }),
      use('m2', 'mcp__jira-delivery__delivery_generate', {}),
    ].join('\n');
    expect(firstTurnToolCalls(stream, 'jira-delivery')).toEqual([
      { name: 'jira_get_issue', input: { issueKey: 'ABC-1' } },
      { name: 'jira_prepare_work_brief', input: { issueKey: 'ABC-1' } },
    ]);
  });

  it('reports a tool from elsewhere under its own name so the case fails', () => {
    expect(firstTurnToolCalls(use('m1', 'Bash'), 'jira-delivery').map((c) => c.name)).toEqual(['Bash']);
  });

  it('ignores lines that are not JSON and returns no calls without a tool call', () => {
    expect(firstTurnToolCalls(['not json', block('m1', { type: 'text', text: 'hi' })].join('\n'), 'jira-delivery')).toEqual([]);
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

  it('only expects tools and arguments the server declares, write tools included', async () => {
    const session = await connect(testDeps({ config: fixtureConfig({ enableWrites: true }) }));
    try {
      const { tools } = await session.client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t]));
      for (const c of cases) {
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
