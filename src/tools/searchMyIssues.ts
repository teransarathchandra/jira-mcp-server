import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { formatSearchResult } from '../utils/formatIssueBrief.js';
import { McpInputError } from '../security/inputValidation.js';
import { safeJqlProjectKey, buildProjectInJql, scopeJql } from '../utils/jql.js';

export interface SearchMyIssuesInput {
  projectKey?: string;  // Optional — specific project to search
  maxResults?: number;  // default 10, max 50
  pageToken?: string;   // nextPageToken from the previous page
  jql?: string;         // optional filter, scoped to projectKey / the strict allowlist
}

export interface SearchMyIssuesResult {
  markdown: string;
  issueKeys: string[];
  /** Set when Jira has more results; pass it back as pageToken. */
  nextPageToken?: string;
}

const OPEN_FOR_ME = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';

function strictAllowlist(config: Config): string[] | undefined {
  const { strictProjectAllowlist, allowedProjectKeys } = config.projectConfig;
  return strictProjectAllowlist && allowedProjectKeys.length > 0 ? allowedProjectKeys : undefined;
}

/** The requested project key, refused when the strict allowlist excludes it. */
function checkedProjectKey(projectKey: string, config: Config): string {
  const key = projectKey.trim().toUpperCase();
  const allowed = strictAllowlist(config);
  if (allowed && !allowed.includes(key)) {
    throw new McpInputError(`Project key "${key}" is not in the allowed list: ${allowed.join(', ')}`, 'projectKey');
  }
  return key;
}

/** The caller's JQL filter, limited to projectKey or, under the strict allowlist, to the allowed projects. */
function filterJql(input: SearchMyIssuesInput, config: Config): string {
  const allowed = strictAllowlist(config);
  const scope =
    input.projectKey !== undefined
      ? `project = "${safeJqlProjectKey(checkedProjectKey(input.projectKey, config))}"`
      : allowed
        ? buildProjectInJql(allowed)
        : undefined;
  try {
    return scopeJql(input.jql ?? '', scope);
  } catch (err) {
    throw new McpInputError(err instanceof Error ? err.message : String(err), 'jql');
  }
}

export async function searchMyIssues(input: SearchMyIssuesInput, client: JiraClient, config: Config): Promise<SearchMyIssuesResult> {
  const maxResults = Math.min(input.maxResults ?? 10, 50);
  const fields = ['summary', 'status', 'priority', 'updated'];

  let jql: string;
  let projectLabel: string | undefined;
  let emptyMessage: string;
  let heading: string | undefined;

  if (input.jql !== undefined) {
    // A caller-supplied filter replaces the "my open issues" query.
    jql = filterJql(input, config);
    heading = '## Issues matching your filter';
    emptyMessage = 'No issues match the filter.';
  } else if (input.projectKey !== undefined) {
    // Case 1: projectKey explicitly provided
    const key = checkedProjectKey(input.projectKey, config);
    jql = `project = "${safeJqlProjectKey(key)}" AND ${OPEN_FOR_ME}`;
    projectLabel = key;
    emptyMessage = `No open issues assigned to you in project ${key}.`;
  } else if (config.projectConfig.defaultProjectKey) {
    // Case 2: use defaultProjectKey
    const defaultKey = config.projectConfig.defaultProjectKey;
    jql = `project = "${safeJqlProjectKey(defaultKey)}" AND ${OPEN_FOR_ME}`;
    projectLabel = defaultKey;
    emptyMessage = `No open issues assigned to you in project ${defaultKey}.`;
  } else if (config.projectConfig.allowedProjectKeys.length > 0) {
    // Case 3: use allowedProjectKeys list
    jql = `${buildProjectInJql(config.projectConfig.allowedProjectKeys)} AND ${OPEN_FOR_ME}`;
    emptyMessage = `No open issues assigned to you across configured projects.`;
  } else {
    // Case 4: no project config at all
    jql = OPEN_FOR_ME;
    emptyMessage = `No open issues assigned to you.`;
  }

  const result = await client.searchIssues(jql, fields, maxResults, input.pageToken);
  const issueKeys = result.issues.map((issue) => issue.key);
  const nextPageToken = result.isLast === true ? undefined : result.nextPageToken;

  if (result.issues.length === 0) {
    return { markdown: input.pageToken ? 'No more issues.' : emptyMessage, issueKeys };
  }

  let markdown = formatSearchResult(result.issues, projectLabel, heading);
  if (nextPageToken) {
    markdown += `\n\nMore issues: call jira_search_issues again with the same arguments plus pageToken: "${nextPageToken}".`;
  }
  return { markdown, issueKeys, ...(nextPageToken ? { nextPageToken } : {}) };
}
