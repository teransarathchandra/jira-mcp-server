// Calls one jira-delivery-mcp tool over stdio, the way an MCP client does,
// and prints what the agent gets back, as Markdown. Used to record the GIFs.
// Usage: node docs/demo/ask.mjs <tool> '<json arguments>'
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const [tool, args = '{}'] = process.argv.slice(2);
const client = new Client({ name: 'demo', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../../dist/index.js', import.meta.url).pathname], env: process.env }));
const result = await client.callTool({ name: tool, arguments: JSON.parse(args) });
const { markdown = result.content?.[0]?.text ?? '', data } = result.structuredContent ?? {};

/** delivery_check_changes: the typed verdict the agent acts on. */
function checkView(d) {
  const icon = { covered: '✅', partial: '🟡', missing: '❌', not_enough_evidence: '❔' };
  const rows = (d.alignment?.criteria ?? []).map((c) => `| ${icon[c.status] ?? ''} ${c.status} | ${c.text} | ${c.files.join(', ') || '—'} |`);
  return [`## Verdict: \`${d.verdict}\``, '', d.summary, '', '| Status | Acceptance criterion | Files |', '|---|---|---|', ...rows].join('\n');
}

let out = tool === 'delivery_check_changes' && data ? checkView(data) : markdown;
// The brief ends with a long implementation prompt; show the part a person reads.
out = out.split(/\n(?=## Implementation prompt)/i)[0];
const maxLines = Number(process.env.ASK_MAX_LINES ?? 0);
if (maxLines > 0) out = out.split('\n').slice(0, maxLines).join('\n');
console.log(out.trimEnd());
await client.close();
