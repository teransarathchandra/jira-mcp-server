import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, testDeps } from '../tests/server/harness.js';
import { fixtureConfig } from '../tests/helpers/jiraFixtures.js';
import {
  EVAL_SERVER_NAME,
  claudeCodeArgs,
  evalRunner,
  firstTurnToolCalls,
  loadCases,
  scoreCase,
  summarize,
  toAnthropicTools,
  type CaseResult,
  type ToolCall,
} from './lib.js';

// npm run eval. With ANTHROPIC_API_KEY it calls the Messages API; without one
// it runs each case through Claude Code (`claude -p`, your own login) against
// the built server. EVAL_RUNNER forces one (api | claude-code), EVAL_MODEL
// picks the model (default claude-haiku-5-5; spot-check with
// claude-sonnet-5-5) and EVAL_MIN_RATE the pass rate to reach (default 0.9).
// EVAL_SKILL=1 adds the jira-delivery skill's text to the system prompt.

const API_KEY = process.env.ANTHROPIC_API_KEY;
const { runner: RUNNER, error: RUNNER_ERROR } = evalRunner(process.env);
const MODEL = process.env.EVAL_MODEL ?? 'claude-haiku-5-5';
const MIN_RATE = Number(process.env.EVAL_MIN_RATE ?? '0.9');
const CONCURRENCY = 4;
const SKILL = process.env.EVAL_SKILL === '1'
  ? readFileSync(new URL('../plugin/skills/jira-delivery/SKILL.md', import.meta.url), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '')
  : undefined;
const LABEL = `${RUNNER}-${MODEL}${SKILL ? '-skill' : ''}`;
const BASE_SYSTEM =
  'You are a coding agent working in a developer\'s repository. The developer uses Jira Cloud. ' +
  'Use one of the available tools to act on the request.';
const SYSTEM = SKILL ? `${BASE_SYSTEM}\n\n${SKILL}` : BASE_SYSTEM;

/** The tool calls in the model's first response (it may call several in parallel). */
async function firstToolCalls(tools: ReturnType<typeof toAnthropicTools>, prompt: string): Promise<ToolCall[]> {
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
    return body.content.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name!, input: b.input ?? {} }));
  }
}

const SERVER_ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));

/**
 * Claude Code runner: a throwaway MCP config for the built server with writes
 * on. JIRA_BASE_URL points at a closed local port, so a tool the model runs
 * fails fast and no Jira is ever contacted.
 */
function claudeCodeSetup(): { mcpConfigPath: string; cwd: string } {
  if (!existsSync(SERVER_ENTRY)) throw new Error('dist/index.js is missing: run `npm run build` first.');
  const dir = mkdtempSync(join(tmpdir(), 'jira-delivery-eval-'));
  const mcpConfigPath = join(dir, 'mcp.json');
  const env = {
    JIRA_BASE_URL: 'http://127.0.0.1:9',
    JIRA_EMAIL: 'eval@example.com',
    JIRA_API_TOKEN: 'eval-token',
    JIRA_ENABLE_WRITES: 'true',
    JIRA_DELIVERY_AUDIT_LOG: join(dir, 'audit.log'),
  };
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { [EVAL_SERVER_NAME]: { command: process.execPath, args: [SERVER_ENTRY], env } } }));
  return { mcpConfigPath, cwd: dir };
}

/** Runs one `claude -p` turn (--max-turns 1) and returns the tool calls of its first turn. */
function claudeCodeToolCalls(setup: { mcpConfigPath: string; cwd: string }, prompt: string): Promise<ToolCall[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', claudeCodeArgs({ prompt, mcpConfigPath: setup.mcpConfigPath, model: MODEL, appendSystemPrompt: SKILL }), {
      cwd: setup.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let timedOut = false;
    // A stuck session scores as a miss for its case instead of aborting the run.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 180_000);
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`could not start Claude Code (is \`claude\` installed and logged in?): ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const calls = firstTurnToolCalls(out, EVAL_SERVER_NAME);
      // --max-turns 1 ends a run that called a tool with a non-zero code; only a run with no model output is a failure to run.
      if (timedOut) console.log(`  timed out: ${prompt}`);
      if (!timedOut && calls.length === 0 && code !== 0 && !out.includes('"type":"assistant"')) {
        reject(new Error(`claude exited with ${code}: ${(err || out).slice(0, 500)}`));
        return;
      }
      resolve(calls);
    });
  });
}

describe(`tool selection (${LABEL})`, () => {
  it(`picks the right tool for at least ${MIN_RATE * 100}% of the cases`, async () => {
    if (RUNNER_ERROR) throw new Error(RUNNER_ERROR);
    const session = await connect(testDeps({ config: fixtureConfig({ enableWrites: true }) }));
    const { tools: mcpTools } = await session.client.listTools();
    await session.close();
    const tools = toAnthropicTools(mcpTools as Parameters<typeof toAnthropicTools>[0]);
    // Writes are enabled in both runners, so every case is scored; a renamed tool fails its cases.
    const cases = loadCases();
    const setup = RUNNER === 'claude-code' ? claudeCodeSetup() : undefined;
    const pick = (prompt: string) => (setup ? claudeCodeToolCalls(setup, prompt) : firstToolCalls(tools, prompt));

    const results: CaseResult[] = [];
    // Strict: only the first call counts, even when the model called the right tool in parallel.
    let strictPassed = 0;
    for (let i = 0; i < cases.length; i += CONCURRENCY) {
      const batch = cases.slice(i, i + CONCURRENCY);
      const calls = await Promise.all(batch.map((c) => pick(c.prompt)));
      batch.forEach((c, j) => {
        results.push({ id: c.id, tool: c.expect.tool, ...scoreCase(c, calls[j]) });
        if (scoreCase(c, calls[j][0]).pass) strictPassed++;
      });
    }

    const summary = summarize(results);
    const strict = { passed: strictPassed, rate: strictPassed / results.length };
    const report = { runner: RUNNER, model: MODEL, skill: Boolean(SKILL), date: new Date().toISOString(), tools: tools.length, ...summary, strict, failures: results.filter((r) => !r.pass) };
    mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
    writeFileSync(new URL(`./results/${LABEL}.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`${LABEL}: ${summary.passed}/${summary.total} (${(summary.rate * 100).toFixed(1)}%), first call only ${strict.passed}/${summary.total}`);
    for (const f of report.failures) console.log(`  ✗ ${f.id}: ${f.reason}`);

    expect(summary.rate).toBeGreaterThanOrEqual(MIN_RATE);
  });
});
