import { McpServer } from '@modelcontextprotocol/server';
import { getServerVersion } from '../version.js';
import type { ServerDeps, ToolRegistrar } from './types.js';
import { registerPrompts } from './prompts.js';
import { ConfirmTokenStore } from '../writes/confirmTokens.js';
import { registerJiraAddComment } from './tools/jiraAddComment.js';
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

const WRITE_REGISTRARS: ToolRegistrar[] = [registerJiraAddComment];

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'jira-delivery-mcp', version: getServerVersion() });
  for (const register of TOOL_REGISTRARS) register(server, deps);
  // Write tools exist only when JIRA_ENABLE_WRITES=true (R3 design §5.1).
  if (deps.config.enableWrites) {
    const writeDeps = { ...deps, confirmTokens: deps.confirmTokens ?? new ConfirmTokenStore() };
    for (const register of WRITE_REGISTRARS) register(server, writeDeps);
  }
  registerPrompts(server);
  registerResources(server, deps);
  return server;
}
