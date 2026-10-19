import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';
import type { JiraClient } from '../jiraClient.js';

export interface ServerDeps {
  config: Config;
  jiraClient: JiraClient;
}

export type ToolRegistrar = (server: McpServer, deps: ServerDeps) => void;
