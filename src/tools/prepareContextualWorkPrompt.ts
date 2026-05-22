import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { fetchIssueContext, ContextFetchOptions } from '../jira/issueContextService.js';
import { formatContextBrief, extractContextImplementationPrompt } from '../utils/formatContextBrief.js';
import { processUntrustedContent, getUntrustedContentDisclaimer } from '../security/untrustedContentGuard.js';

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
  const promptSection = extractContextImplementationPrompt(brief);

  // Wrap the main issue description with untrusted content guard
  const parts: string[] = [];

  if (context.mainIssueDescription) {
    const { wrapped, warningBlock } = processUntrustedContent(
      `Jira ${input.issueKey}`,
      context.mainIssueDescription
    );
    if (warningBlock) {
      parts.push(warningBlock);
    }
    parts.push(wrapped);
    parts.push('');
  }

  parts.push(promptSection);
  parts.push('');
  parts.push(getUntrustedContentDisclaimer());

  return parts.join('\n');
}
