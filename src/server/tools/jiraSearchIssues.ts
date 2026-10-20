import { z } from 'zod';
import { searchMyIssues } from '../../tools/searchMyIssues.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { errorResult } from '../errors.js';
import { READ_ONLY_REMOTE } from '../annotations.js';
import type { ToolRegistrar } from '../types.js';

const NAME = 'jira_search_issues';

export const registerJiraSearchIssues: ToolRegistrar = (server, { config, jiraClient }) => {
  server.registerTool(
    NAME,
    {
      title: 'Search Jira issues',
      description:
        'List open Jira issues assigned to the authenticated user, optionally limited to one project. Use this to find what to work on next. ' +
        'Pass jql to search with your own filter instead (e.g. "type = Bug AND sprint in openSprints() ORDER BY priority DESC"); ' +
        'it is limited to projectKey when given, and to the allowed projects when the strict allowlist is on. ' +
        'When more results exist, data.nextPageToken is set: pass it back as pageToken for the next page.',
      inputSchema: z.object({
        projectKey: z.string().optional().describe('Project key to search (e.g. ENG). Defaults to the configured default project.'),
        maxResults: z.number().int().min(1).max(50).default(10).describe('Maximum issues to return (1-50).'),
        pageToken: z.string().min(1).max(2048).optional().describe('nextPageToken from the previous page'),
        jql: z.string().min(1).max(1000).optional().describe('JQL filter replacing the default "my open issues" query'),
      }),
      outputSchema: EnvelopeSchema.extend({
        data: z.object({ issueKeys: z.array(z.string()), nextPageToken: z.string().optional() }),
      }),
      annotations: READ_ONLY_REMOTE,
    },
    async (input) => {
      try {
        const { markdown, ...data } = await searchMyIssues(input, jiraClient, config);
        return toolResult(NAME, markdown, { data });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
};
