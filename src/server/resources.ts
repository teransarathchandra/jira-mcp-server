import type { McpServer } from '@modelcontextprotocol/server';
import { listConfiguredProjects } from '../tools/jiraListConfiguredProjects.js';
import type { ServerDeps } from './types.js';

export const PROJECTS_RESOURCE_URI = 'jira-delivery://config/projects';

export function registerResources(server: McpServer, { config }: ServerDeps): void {
  server.registerResource(
    'configured-projects',
    PROJECTS_RESOURCE_URI,
    {
      title: 'Configured Jira projects',
      description: 'Default project, allowed project keys and the issue-key format this server accepts.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: listConfiguredProjects(config.projectConfig) }],
    }),
  );
}
