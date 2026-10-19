import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { INVALID_TOKEN_MESSAGE, type ElicitFn, type WriteOutcome } from '../writes/guardedWrite.js';
import { toolResult } from './envelope.js';

// Shared result shape and elicitation check for the write tools.

export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/** Form elicitation only: a URL-only client cannot show a confirmation form. */
export function formElicitation(server: McpServer, elicitInput: unknown): ElicitFn | undefined {
  const caps = server.server.getClientCapabilities()?.elicitation as Record<string, unknown> | undefined;
  if (!caps) return undefined;
  const supportsForm = 'form' in caps || Object.keys(caps).length === 0;
  return supportsForm ? (elicitInput as ElicitFn) : undefined;
}

export function writeToolResult(tool: string, issueKey: string, outcome: WriteOutcome): CallToolResult {
  if (outcome.refused) {
    return { content: [{ type: 'text', text: INVALID_TOKEN_MESSAGE }], isError: true };
  }
  const { refused: _refused, warnings, ...data } = outcome;
  const warningLines = warnings.length > 0 ? ['', ...warnings.map((w) => `Warning: ${w}`)] : [];

  if (outcome.declined) {
    const text = [`## The user declined — nothing was changed in ${issueKey}`, '', outcome.preview].join('\n');
    return toolResult(tool, text, { issueKey, warnings, data });
  }

  if (!outcome.applied && outcome.results.length === 0) {
    const text = [
      `## Preview — nothing has been changed in ${issueKey} yet`,
      '',
      outcome.preview,
      '',
      `To apply, call ${tool} again with the same arguments plus confirmToken: "${outcome.confirmToken}" (valid for 5 minutes, once).`,
    ].join('\n');
    return toolResult(tool, text, { issueKey, warnings, data });
  }

  const lines = outcome.results.map((r) => {
    if (r.outcome === 'applied') return `- ${r.action}: applied${r.detail ? ` (${r.detail})` : ''}`;
    if (r.outcome === 'failed') return `- ${r.action}: FAILED — ${r.error ?? r.detail ?? 'unknown error'}`;
    return `- ${r.action}: skipped (an earlier step failed)`;
  });
  const failed = outcome.results.some((r) => r.outcome === 'failed');
  const heading = failed ? (outcome.applied ? `Partially applied to ${issueKey}` : `Nothing was changed in ${issueKey}`) : `Applied to ${issueKey}`;
  const text = [`## ${heading}`, '', ...lines, ...warningLines].join('\n');
  if (!outcome.applied) return { content: [{ type: 'text', text }], isError: true };
  return toolResult(tool, text, { issueKey, warnings: [...warnings, ...(failed ? ['a write step failed'] : [])], data });
}
