import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { fetchIssueContext, ContextFetchOptions } from '../jira/issueContextService.js';
import { formatContextBrief, extractContextImplementationPrompt } from '../utils/formatContextBrief.js';

export interface PrepareContextualWorkPromptInput {
  issueKey: string;
  includeComments?: boolean;
  includeParent?: boolean;
  includeEpic?: boolean;
  includeLinkedIssues?: boolean;
  includeSubtasks?: boolean;
  includeEpicSiblings?: boolean;
}

export async function prepareContextualWorkPrompt(
  input: PrepareContextualWorkPromptInput,
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
    maxLinkedIssues: 8,
    maxSubtasks: 10,
    maxCommentsPerIssue: 10,
    contextDepth: 1,
  };

  const context = await fetchIssueContext(input.issueKey, options, client, config);
  const brief = formatContextBrief(context);
  return extractContextImplementationPrompt(brief);
}
