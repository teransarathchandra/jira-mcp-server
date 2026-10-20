// Calls one jira-delivery-mcp tool over stdio, the way an MCP client does,
// and prints the Markdown it returns. Used to record the README demo.
// Usage: node demo/ask.mjs <tool> '<json arguments>'
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const [tool, args = '{}'] = process.argv.slice(2);
const client = new Client({ name: 'demo', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname], env: process.env }));
const result = await client.callTool({ name: tool, arguments: JSON.parse(args) });
const markdown = result.structuredContent?.markdown ?? result.content?.[0]?.text ?? '';
// The brief ends with a long implementation prompt; the demo shows the part a person reads.
console.log(markdown.split(/\n(?=## Implementation prompt)/i)[0].trimEnd());
await client.close();
