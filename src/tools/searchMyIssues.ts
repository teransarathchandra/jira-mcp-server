import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { formatSearchResult } from '../utils/formatIssueBrief.js';
import { McpInputError } from '../security/inputValidation.js';

export interface SearchMyIssuesInput {
  projectKey?: string;  // Optional — specific project to search
  maxResults?: number;  // default 10, max 50
}

function escapeJqlProjectKey(key: string): string {
  return key.replace(/["\\]/g, '\\$&');
}

export async function searchMyIssues(input: SearchMyIssuesInput, client: JiraClient, config: Config): Promise<string> {
  const maxResults = Math.min(input.maxResults ?? 10, 50);
  const fields = ['summary', 'status', 'priority', 'updated'];

  // Case 1: projectKey explicitly provided
  if (input.projectKey !== undefined) {
    const key = input.projectKey.trim().toUpperCase();

    if (
      config.projectConfig.strictProjectAllowlist &&
      config.projectConfig.allowedProjectKeys.length > 0
    ) {
      const inAllowlist = config.projectConfig.allowedProjectKeys.includes(key);
      if (!inAllowlist) {
        const list = config.projectConfig.allowedProjectKeys.join(', ');
        throw new McpInputError(
          `Project key "${key}" is not in the allowed list: ${list}`,
          'projectKey'
        );
      }
    }

    const escapedKey = escapeJqlProjectKey(key);
    const jql = `project = "${escapedKey}" AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`;
    const result = await client.searchIssues(jql, fields, maxResults);

    if (result.issues.length === 0) {
      return `No open issues assigned to you in project ${key}.`;
    }

    return formatSearchResult(result.issues, key);
  }

  // Case 2: use defaultProjectKey
  if (config.projectConfig.defaultProjectKey) {
    const defaultKey = config.projectConfig.defaultProjectKey;
    const escapedKey = escapeJqlProjectKey(defaultKey);
    const jql = `project = "${escapedKey}" AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`;
    const result = await client.searchIssues(jql, fields, maxResults);

    if (result.issues.length === 0) {
      return `No open issues assigned to you in project ${defaultKey}.`;
    }

    return formatSearchResult(result.issues, defaultKey);
  }

  // Case 3: use allowedProjectKeys list
  if (config.projectConfig.allowedProjectKeys.length > 0) {
    const keyList = config.projectConfig.allowedProjectKeys.map(k => `"${k}"`).join(', ');
    const jql = `project in (${keyList}) AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`;
    const result = await client.searchIssues(jql, fields, maxResults);

    if (result.issues.length === 0) {
      return `No open issues assigned to you across configured projects.`;
    }

    return formatSearchResult(result.issues);
  }

  // Case 4: no project config at all
  const jql = `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`;
  const result = await client.searchIssues(jql, fields, maxResults);

  if (result.issues.length === 0) {
    return `No open issues assigned to you.`;
  }

  return formatSearchResult(result.issues);
}
