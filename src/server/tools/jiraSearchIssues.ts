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
      title: 'Search my open Jira issues',
      description:
        'List open Jira issues assigned to the authenticated user, optionally limited to one project. Use this to find what to work on next. ' +
        'When more results exist, data.nextPageToken is set: pass it back as pageToken for the next page.',
      inputSchema: z.object({
        projectKey: z.string().optional().describe('Project key to search (e.g. ENG). Defaults to the configured default project.'),
        maxResults: z.number().int().min(1).max(50).default(10).describe('Maximum issues to return (1-50).'),
        pageToken: z.string().min(1).max(2048).optional().describe('nextPageToken from the previous page'),
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
