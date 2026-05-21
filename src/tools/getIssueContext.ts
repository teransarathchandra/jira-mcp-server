import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { fetchIssueContext, ContextFetchOptions } from '../jira/issueContextService.js';
import { formatContextBrief } from '../utils/formatContextBrief.js';

export interface GetIssueContextInput {
  issueKey: string;
  includeComments?: boolean;
  includeParent?: boolean;
  includeEpic?: boolean;
  includeLinkedIssues?: boolean;
  includeSubtasks?: boolean;
  includeEpicSiblings?: boolean;
  maxLinkedIssues?: number;
  maxSubtasks?: number;
  maxCommentsPerIssue?: number;
  contextDepth?: number;
}

export async function getIssueContext(
  input: GetIssueContextInput,
  client: JiraClient,
  config: Config
): Promise<string> {
  validateIssueKey(input.issueKey);

  const options: ContextFetchOptions = {
    includeComments: input.includeComments ?? true,
    includeParent: input.includeParent ?? true,
    includeEpic: input.includeEpic ?? true,
    includeLinkedIssues: input.includeLinkedIssues ?? true,
    includeSubtasks: input.includeSubtasks ?? true,
    includeEpicSiblings: input.includeEpicSiblings ?? false,
    maxLinkedIssues: Math.min(input.maxLinkedIssues ?? 8, 15),
    maxSubtasks: Math.min(input.maxSubtasks ?? 10, 20),
    maxCommentsPerIssue: Math.min(input.maxCommentsPerIssue ?? 10, 20),
    contextDepth: Math.min(input.contextDepth ?? 1, 2),
  };

  const context = await fetchIssueContext(input.issueKey, options, client, config);
  return formatContextBrief(context);
}
