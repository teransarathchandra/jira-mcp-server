import { McpServer } from '@modelcontextprotocol/server';
import { getServerVersion } from '../version.js';
import type { ServerDeps, ToolRegistrar } from './types.js';
import { registerJiraSearchIssues } from './tools/jiraSearchIssues.js';

const TOOL_REGISTRARS: ToolRegistrar[] = [
  registerJiraSearchIssues,
];

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'jira-delivery-mcp', version: getServerVersion() });
  for (const register of TOOL_REGISTRARS) register(server, deps);
  return server;
}
