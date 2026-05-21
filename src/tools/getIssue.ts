import { JiraClient } from '../jiraClient.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { formatIssueBrief } from '../utils/formatIssueBrief.js';

export interface GetIssueInput {
  issueKey: string;
  includeComments?: boolean;   // currently ignored — comments always included from API
  includeAttachments?: boolean; // currently ignored — attachments always included from API
}

export async function getIssue(input: GetIssueInput, client: JiraClient): Promise<string> {
  // 1. Validate the issue key (throws if invalid)
  validateIssueKey(input.issueKey);

  // 2. Fetch from Jira
  const issue = await client.getIssue(input.issueKey);

  // 3. Format and return the brief
  return formatIssueBrief(issue);
}
