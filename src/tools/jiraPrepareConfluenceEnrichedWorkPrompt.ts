import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import {
  jiraGetIssueWithConfluenceContext,
  type JiraGetIssueWithConfluenceContextInput,
} from './jiraGetIssueWithConfluenceContext.js';

export interface JiraPrepareConfluenceEnrichedWorkPromptInput {
  issueKey: string;
  includeConfluence?: boolean;
  confluenceMaxPagesToRead?: number;
}

export async function jiraPrepareConfluenceEnrichedWorkPrompt(
  input: JiraPrepareConfluenceEnrichedWorkPromptInput,
  client: JiraClient,
  config: Config
): Promise<string> {
  validateIssueKey(input.issueKey);

  const contextInput: JiraGetIssueWithConfluenceContextInput = {
    issueKey: input.issueKey,
    includeConfluence: input.includeConfluence ?? true,
    confluenceMaxPagesToRead: input.confluenceMaxPagesToRead,
  };

  const fullOutput = await jiraGetIssueWithConfluenceContext(contextInput, client, config);

  // Extract only the "Final Implementation Prompt" section
  const sectionHeading = '## Final Implementation Prompt';
  const sectionStart = fullOutput.indexOf(sectionHeading);

  if (sectionStart === -1) {
    return fullOutput;
  }

  return fullOutput.slice(sectionStart).trim();
}
