import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, testDeps } from '../tests/server/harness.js';
import { fixtureConfig } from '../tests/helpers/jiraFixtures.js';
import { loadCases, scoreCase, summarize, toAnthropicTools, type CaseResult, type ToolCall } from './lib.js';

// npm run eval — needs ANTHROPIC_API_KEY. EVAL_MODEL picks the model
// (default claude-haiku-5-5; spot-check with claude-sonnet-5-5) and
// EVAL_MIN_RATE the pass rate the run must reach (default 0.9).

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.EVAL_MODEL ?? 'claude-haiku-5-5';
const MIN_RATE = Number(process.env.EVAL_MIN_RATE ?? '0.9');
const CONCURRENCY = 4;
const SYSTEM =
  'You are a coding agent working in a developer\'s repository. The developer uses Jira Cloud. ' +
  'Use one of the available tools to act on the request.';

async function firstToolCall(tools: ReturnType<typeof toAnthropicTools>, prompt: string): Promise<ToolCall | undefined> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, tools, messages: [{ role: 'user', content: prompt }] }),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { content: Array<{ type: string; name?: string; input?: Record<string, unknown> }> };
    const use = body.content.find((b) => b.type === 'tool_use');
    return use ? { name: use.name!, input: use.input ?? {} } : undefined;
  }
}

describe.skipIf(!API_KEY)(`tool selection (${MODEL})`, () => {
  it(`picks the right tool for at least ${MIN_RATE * 100}% of the cases`, async () => {
    const session = await connect(testDeps({ config: fixtureConfig({ enableWrites: true }) }));
    const { tools: mcpTools } = await session.client.listTools();
    await session.close();
    const tools = toAnthropicTools(mcpTools as Parameters<typeof toAnthropicTools>[0]);
    const names = new Set(tools.map((t) => t.name));
    const cases = loadCases().filter((c) => !c.requiresWrites || names.has(c.expect.tool));

    const results: CaseResult[] = [];
    for (let i = 0; i < cases.length; i += CONCURRENCY) {
      const batch = cases.slice(i, i + CONCURRENCY);
      const calls = await Promise.all(batch.map((c) => firstToolCall(tools, c.prompt)));
      batch.forEach((c, j) => results.push({ id: c.id, tool: c.expect.tool, ...scoreCase(c, calls[j]) }));
    }

    const summary = summarize(results);
    const report = { model: MODEL, date: new Date().toISOString(), tools: tools.length, ...summary, failures: results.filter((r) => !r.pass) };
    mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
    writeFileSync(new URL(`./results/${MODEL}.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`${MODEL}: ${summary.passed}/${summary.total} (${(summary.rate * 100).toFixed(1)}%)`);
    for (const f of report.failures) console.log(`  ✗ ${f.id}: ${f.reason}`);

    expect(summary.rate).toBeGreaterThanOrEqual(MIN_RATE);
  });
});
