import { z } from 'zod';
import { confluenceSearchRelatedPages } from '../../tools/confluenceSearchRelatedPages.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { errorResult } from '../errors.js';
import { READ_ONLY_REMOTE } from '../annotations.js';
import type { ToolRegistrar } from '../types.js';
import { issueKeyField } from './jiraIssueInputs.js';

const NAME = 'confluence_search';

export const registerConfluenceSearch: ToolRegistrar = (server, { config, jiraClient }) => {
  server.registerTool(
    NAME,
    {
      title: 'Search Confluence for pages related to a Jira issue',
      description:
        'Find Confluence pages relevant to a Jira issue (specs, designs, runbooks), ranked by relevance and authority.',
      inputSchema: z.object({
        issueKey: issueKeyField(config),
        maxResults: z.number().int().min(1).max(50).default(10).describe('Maximum search results (1-50).'),
        spaceKeys: z.array(z.string()).default([]).describe('Restrict to these space keys (default: all configured spaces).'),
        includeLowRelevance: z.boolean().default(false).describe('Include low-relevance pages.'),
      }),
      outputSchema: EnvelopeSchema,
      annotations: READ_ONLY_REMOTE,
    },
    async (input) => {
      try {
        return toolResult(NAME, await confluenceSearchRelatedPages(input, jiraClient, config), { issueKey: input.issueKey });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
};
