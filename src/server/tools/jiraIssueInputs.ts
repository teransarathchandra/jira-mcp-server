import { z } from 'zod';
import type { Config } from '../../config.js';

// Shared inputs and v1 defaults for the consolidated jira_get_issue and
// jira_prepare_work_brief tools. The defaults are copied from the v1 Zod
// schemas so behaviour is unchanged for callers that omit them.

export function issueKeyField(config: Config) {
  return z.string().describe(`Jira issue key (e.g. ${config.projectConfig.exampleIssueKey})`);
}

export const depthField = z
  .enum(['basic', 'full'])
  .default('basic')
  .describe('basic = the issue only; full = also parent, epic, linked issues, subtasks and comments');

export const includeConfluenceField = z
  .boolean()
  .default(false)
  .describe('Also search Confluence for related pages and fold them into the result (implies full depth)');

/** v1 GetIssueSchema defaults. */
export const BASIC_ISSUE_DEFAULTS = { includeComments: true, includeAttachments: true } as const;

/** v1 PrepareContextualWorkPromptSchema defaults (a subset of the context defaults). */
export const CONTEXT_INCLUDE_DEFAULTS = {
  includeComments: true,
  includeParent: true,
  includeEpic: true,
  includeLinkedIssues: true,
  includeSubtasks: true,
  includeEpicSiblings: false,
} as const;

/** v1 GetIssueContextSchema defaults. */
export const CONTEXT_FETCH_DEFAULTS = {
  ...CONTEXT_INCLUDE_DEFAULTS,
  maxLinkedIssues: 8,
  maxSubtasks: 10,
  maxCommentsPerIssue: 10,
  contextDepth: 1,
} as const;

/** v1 JiraGetIssueWithConfluenceContextSchema defaults. */
export const CONFLUENCE_CONTEXT_DEFAULTS = {
  includeJiraComments: true,
  includeParent: true,
  includeEpic: true,
  includeLinkedIssues: true,
  includeSubtasks: true,
  includeConfluence: true,
  includeMediumRelevancePages: true,
  includeLowRelevancePages: false,
} as const;

/** v1 JiraPrepareConfluenceEnrichedWorkPromptSchema defaults. */
export const CONFLUENCE_BRIEF_DEFAULTS = { includeConfluence: true, confluenceMaxPagesToRead: 5 } as const;
