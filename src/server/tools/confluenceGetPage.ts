import { z } from 'zod';
import { confluenceGetPageSummary } from '../../tools/confluenceGetPageSummary.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { errorResult } from '../errors.js';
import { READ_ONLY_REMOTE } from '../annotations.js';
import type { ToolRegistrar } from '../types.js';

const NAME = 'confluence_get_page';

export const registerConfluenceGetPage: ToolRegistrar = (server, { config, jiraClient }) => {
  server.registerTool(
    NAME,
    {
      title: 'Get a Confluence page',
      description: 'Read a Confluence page by ID and return a cleaned, size-bounded summary of its content.',
      inputSchema: z.object({
        pageId: z.string().describe('Confluence page ID'),
        maxChars: z.number().int().min(1000).max(50000).default(12000).describe('Maximum characters of page body (1000-50000).'),
      }),
      outputSchema: EnvelopeSchema,
      annotations: READ_ONLY_REMOTE,
    },
    async (input) => {
      try {
        return toolResult(NAME, await confluenceGetPageSummary(input, jiraClient, config));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
};
