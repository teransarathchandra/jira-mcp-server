import { parseClientProfile, getClientSetupInstructions } from '../clientProfiles/clientProfileConfig.js';

export interface McpGetClientSetupInstructionsInput {
  client?: string;         // one of McpClientProfile values; defaults to current MCP_CLIENT_PROFILE or 'generic'
  serverName?: string;     // e.g. "jira-delivery-mcp"
  serverCommand?: string;  // e.g. "node"
  serverArgs?: string[];   // e.g. ["/path/to/dist/index.js"]
}

export function mcpGetClientSetupInstructions(
  input: McpGetClientSetupInstructionsInput,
): string {
  const profile = parseClientProfile(input.client ?? process.env['MCP_CLIENT_PROFILE']);
  const serverName = input.serverName ?? 'jira-delivery-mcp';
  const serverCommand = input.serverCommand ?? 'node';
  const serverArgs = input.serverArgs ?? ['/path/to/dist/index.js'];
  return getClientSetupInstructions(profile, serverName, serverCommand, serverArgs);
}
