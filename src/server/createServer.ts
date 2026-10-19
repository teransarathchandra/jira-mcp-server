import { McpServer } from '@modelcontextprotocol/server';
import { getServerVersion } from '../version.js';
import type { ServerDeps, ToolRegistrar } from './types.js';
import { registerJiraSearchIssues } from './tools/jiraSearchIssues.js';
import { registerJiraGetIssue } from './tools/jiraGetIssue.js';
import { registerJiraPrepareWorkBrief } from './tools/jiraPrepareWorkBrief.js';

const TOOL_REGISTRARS: ToolRegistrar[] = [
  registerJiraGetIssue,
  registerJiraSearchIssues,
  registerJiraPrepareWorkBrief,
];

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'jira-delivery-mcp', version: getServerVersion() });
  for (const register of TOOL_REGISTRARS) register(server, deps);
  return server;
}
