import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { formatSearchResult } from '../utils/formatIssueBrief.js';

export interface SearchMyIssuesInput {
  maxResults?: number; // default 10, max 50
}

export async function searchMyIssues(input: SearchMyIssuesInput, client: JiraClient, config: Config): Promise<string> {
  const maxResults = Math.min(input.maxResults ?? 10, 50);

  // JQL: CMPI project, assigned to current user, not done
  const jql = `project = ${config.projectKey} AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`;

  const fields = ['summary', 'status', 'priority', 'updated'];

  const result = await client.searchIssues(jql, fields, maxResults);

  if (result.issues.length === 0) {
    return `No open ${config.projectKey} issues assigned to you.`;
  }

  return formatSearchResult(result.issues, config.projectKey);
}
