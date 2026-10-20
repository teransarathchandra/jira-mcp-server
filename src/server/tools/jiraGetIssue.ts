import { z } from 'zod';
import { getIssue } from '../../tools/getIssue.js';
import { getIssueContext } from '../../tools/getIssueContext.js';
import { jiraGetIssueWithConfluenceContext } from '../../tools/jiraGetIssueWithConfluenceContext.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { errorResult } from '../errors.js';
import { READ_ONLY_REMOTE } from '../annotations.js';
import type { ToolRegistrar } from '../types.js';
import {
  issueKeyField,
  depthField,
  includeConfluenceField,
  BASIC_ISSUE_DEFAULTS,
  CONTEXT_FETCH_DEFAULTS,
  CONFLUENCE_CONTEXT_DEFAULTS,
} from './jiraIssueInputs.js';

const NAME = 'jira_get_issue';

export const registerJiraGetIssue: ToolRegistrar = (server, { config, jiraClient }) => {
  server.registerTool(
    NAME,
    {
      title: 'Get a Jira issue',
      description:
        'Fetch a Jira issue as a developer brief: description, acceptance criteria, comments and attachments. ' +
        'Use depth "full" for parent/epic/linked-issue context and includeConfluence for related documentation. ' +
        'Use this to read a ticket. To start work, check readiness, verify changes or write a report, call ' +
        'jira_prepare_work_brief or the delivery_* tool directly: they fetch the issue themselves.',
      inputSchema: z.object({
        issueKey: issueKeyField(config),
        depth: depthField,
        includeConfluence: includeConfluenceField,
      }),
      outputSchema: EnvelopeSchema,
      annotations: READ_ONLY_REMOTE,
    },
    async ({ issueKey, depth, includeConfluence }) => {
      try {
        let markdown: string;
        if (includeConfluence) {
          markdown = await jiraGetIssueWithConfluenceContext({ issueKey, ...CONFLUENCE_CONTEXT_DEFAULTS }, jiraClient, config);
        } else if (depth === 'full') {
          markdown = await getIssueContext({ issueKey, ...CONTEXT_FETCH_DEFAULTS }, jiraClient, config);
        } else {
          markdown = await getIssue({ issueKey, ...BASIC_ISSUE_DEFAULTS }, jiraClient);
        }
        return toolResult(NAME, markdown, { issueKey });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
};
