import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';
import type { JiraClient } from '../jiraClient.js';
import type { ConfirmTokenStore } from '../writes/confirmTokens.js';

export interface ServerDeps {
  config: Config;
  jiraClient: JiraClient;
  /** Set by createServer; one store per server so tokens never cross servers. */
  confirmTokens?: ConfirmTokenStore;
}

export type ToolRegistrar = (server: McpServer, deps: ServerDeps) => void;
