import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';

// Shared output contract for every v2 tool (spec §4). R2 adds a typed `data`
// field to the headline tools.
export const EnvelopeSchema = z.object({
  schemaVersion: z.literal('2.0'),
  tool: z.string(),
  issueKey: z.string().optional(),
  markdown: z.string(),
  warnings: z.array(z.string()),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

export function toolResult(
  tool: string,
  markdown: string,
  opts: { issueKey?: string; warnings?: string[]; data?: object } = {},
): CallToolResult {
  const envelope: Envelope & { data?: object } = {
    schemaVersion: '2.0',
    tool,
    ...(opts.issueKey !== undefined ? { issueKey: opts.issueKey } : {}),
    markdown,
    warnings: opts.warnings ?? [],
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  };
  return {
    content: [{ type: 'text', text: markdown }],
    structuredContent: envelope,
  };
}
