#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { getConfig } from './config.js';
import { JiraClient } from './jiraClient.js';
import { createServer } from './server/createServer.js';
import { parseCommand, runCommand } from './cli.js';

async function main() {
  const command = parseCommand(process.argv.slice(2));
  if (command.kind !== 'serve') {
    process.exit(await runCommand(command));
  }

  // Validate env vars at startup — fail fast with clear error
  const config = getConfig();
  const server = createServer({ config, jiraClient: new JiraClient(config) });
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error('Fatal error starting Jira MCP server:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
