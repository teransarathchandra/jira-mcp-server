import { readFileSync } from 'node:fs';

// Tool-selection evals (v2 design Q19): given the server's real tool list, does
// a model pick the right tool, with the right key arguments, for a developer's
// request? Pure helpers here; evals/toolSelection.eval.ts calls the model,
// either through the Anthropic API or through the Claude Code CLI.

export interface EvalCase {
  id: string;
  prompt: string;
  expect: { tool: string; args?: Record<string, unknown> };
  /** Only scored when the write tools are registered. */
  requiresWrites?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface CaseResult {
  id: string;
  tool: string;
  pass: boolean;
  reason?: string;
}

export type EvalRunnerName = 'api' | 'claude-code';

/**
 * Which model runner `npm run eval` uses: EVAL_RUNNER, else the Anthropic API
 * when ANTHROPIC_API_KEY is set, else Claude Code (`claude -p`, the user's own
 * login). A runner that cannot work fails the run rather than skipping it green.
 */
export function evalRunner(env: Record<string, string | undefined>): { runner: EvalRunnerName; error?: string } {
  const requested = env.EVAL_RUNNER?.trim();
  if (requested && requested !== 'api' && requested !== 'claude-code') {
    return { runner: 'api', error: `EVAL_RUNNER must be "api" or "claude-code", not "${requested}".` };
  }
  const runner: EvalRunnerName = (requested as EvalRunnerName | undefined) ?? (env.ANTHROPIC_API_KEY ? 'api' : 'claude-code');
  if (runner === 'api' && !env.ANTHROPIC_API_KEY) {
    return { runner, error: 'ANTHROPIC_API_KEY is not set: the api runner calls the Anthropic API and cannot run without it.' };
  }
  return { runner };
}

/** The MCP server name the Claude Code runner registers; its tools appear as mcp__<name>__<tool>. */
export const EVAL_SERVER_NAME = 'jira-delivery';

/** One non-interactive Claude Code turn with only this server's tools and none of the user's settings. */
export function claudeCodeArgs(opts: { prompt: string; mcpConfigPath: string; model: string }): string[] {
  return [
    '-p', opts.prompt,
    '--model', opts.model,
    '--strict-mcp-config', '--mcp-config', opts.mcpConfigPath,
    '--tools', '',
    '--setting-sources', '',
    '--output-format', 'stream-json', '--verbose',
    '--max-turns', '1',
    '--no-session-persistence',
  ];
}

/**
 * The tool calls of the first turn that calls a tool, in a `claude -p
 * --output-format stream-json` transcript. Claude Code streams each content
 * block as its own assistant event; blocks of one turn share the message id.
 */
export function firstTurnToolCalls(stream: string, serverName: string): ToolCall[] {
  const prefix = `mcp__${serverName}__`;
  const calls: ToolCall[] = [];
  let turnId: string | undefined;
  for (const line of stream.split('\n')) {
    let event: { type?: string; message?: { id?: string; content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }> } };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (calls.length > 0 && (event.type !== 'assistant' || event.message?.id !== turnId)) break;
    if (event.type !== 'assistant') continue;
    for (const block of event.message?.content ?? []) {
      if (block.type !== 'tool_use' || !block.name) continue;
      turnId = event.message?.id;
      calls.push({ name: block.name.startsWith(prefix) ? block.name.slice(prefix.length) : block.name, input: block.input ?? {} });
    }
  }
  return calls;
}

export function loadCases(): EvalCase[] {
  return JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')) as EvalCase[];
}

export function toAnthropicTools(tools: McpTool[]) {
  return tools.map((t) => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema }));
}

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

function sameValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    const have = new Set(actual.map(norm));
    return expected.every((e) => have.has(norm(e)));
  }
  return norm(actual) === norm(expected);
}

/**
 * Right tool, and every expected argument present with the same value (strings
 * case-insensitive). With several calls from one turn (parallel tool use), the
 * one naming the expected tool is scored.
 */
export function scoreCase(c: EvalCase, calls: ToolCall | ToolCall[] | undefined): { pass: boolean; reason?: string } {
  const list = calls === undefined ? [] : Array.isArray(calls) ? calls : [calls];
  const call = list.find((x) => x.name === c.expect.tool) ?? list[0];
  if (!call) return { pass: false, reason: 'no tool call' };
  if (call.name !== c.expect.tool) return { pass: false, reason: `called ${call.name}, expected ${c.expect.tool}` };
  for (const [key, expected] of Object.entries(c.expect.args ?? {})) {
    if (!sameValue(call.input[key], expected)) {
      return { pass: false, reason: `${key} was ${JSON.stringify(call.input[key])}, expected ${JSON.stringify(expected)}` };
    }
  }
  return { pass: true };
}

export function summarize(results: CaseResult[]) {
  const byTool: Record<string, { passed: number; total: number }> = {};
  for (const r of results) {
    const t = (byTool[r.tool] ??= { passed: 0, total: 0 });
    t.total++;
    if (r.pass) t.passed++;
  }
  const passed = results.filter((r) => r.pass).length;
  return { passed, total: results.length, rate: results.length ? passed / results.length : 0, byTool };
}
