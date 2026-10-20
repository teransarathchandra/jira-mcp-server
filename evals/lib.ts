import { readFileSync } from 'node:fs';

// Tool-selection evals (v2 design Q19): given the server's real tool list, does
// a model pick the right tool, with the right key arguments, for a developer's
// request? Pure helpers here; evals/toolSelection.eval.ts calls the model.

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

/** Why `npm run eval` cannot run, or null. A missing key fails the run rather than skipping it green. */
export function evalSetupError(env: Record<string, string | undefined>): string | null {
  return env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY is not set: npm run eval calls the Anthropic API and cannot run without it.';
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

/** Right tool, and every expected argument present with the same value (strings case-insensitive). */
export function scoreCase(c: EvalCase, call: ToolCall | undefined): { pass: boolean; reason?: string } {
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
