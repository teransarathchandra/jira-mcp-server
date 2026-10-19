import { McpServer } from '@modelcontextprotocol/server';
import { getServerVersion } from '../version.js';
import type { ServerDeps, ToolRegistrar } from './types.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerJiraSearchIssues } from './tools/jiraSearchIssues.js';
import { registerJiraGetIssue } from './tools/jiraGetIssue.js';
import { registerJiraPrepareWorkBrief } from './tools/jiraPrepareWorkBrief.js';
import { registerConfluenceSearch } from './tools/confluenceSearch.js';
import { registerConfluenceGetPage } from './tools/confluenceGetPage.js';
import { registerDeliveryCheckChanges } from './tools/deliveryCheckChanges.js';
import { registerDeliveryTraceabilityMatrix } from './tools/deliveryTraceabilityMatrix.js';
import { registerDeliveryGenerate } from './tools/deliveryGenerate.js';
import { registerDeliveryGenerateAgentPack } from './tools/deliveryGenerateAgentPack.js';
import { registerDeliveryProjectPatterns } from './tools/deliveryProjectPatterns.js';

const TOOL_REGISTRARS: ToolRegistrar[] = [
  registerJiraGetIssue,
  registerJiraSearchIssues,
  registerJiraPrepareWorkBrief,
  registerConfluenceSearch,
  registerConfluenceGetPage,
  registerDeliveryCheckChanges,
  registerDeliveryTraceabilityMatrix,
  registerDeliveryGenerate,
  registerDeliveryGenerateAgentPack,
  registerDeliveryProjectPatterns,
];

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'jira-delivery-mcp', version: getServerVersion() });
  for (const register of TOOL_REGISTRARS) register(server, deps);
  registerPrompts(server);
  registerResources(server, deps);
  return server;
}
