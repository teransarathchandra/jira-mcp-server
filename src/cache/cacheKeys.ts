import { createHash } from 'node:crypto';

export function hashForCacheKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function jiraIssueKey(issueKey: string): string {
  return `jira:issue:${issueKey}`;
}

export function jiraSearchKey(jql: string, maxResults: number): string {
  return `jira:search:${hashForCacheKey(jql)}:${maxResults}`;
}

export function confluencePageKey(pageId: string): string {
  return `confluence:page:${pageId}`;
}

export function confluenceSearchKey(
  query: string,
  spaceKeys: string[],
  maxResults: number,
): string {
  const combined = query + spaceKeys.join(',');
  return `confluence:search:${hashForCacheKey(combined)}:${maxResults}`;
}

export function gitDiffKey(repoPath: string, baseBranch: string, compareRef: string): string {
  return `git:diff:${hashForCacheKey(repoPath)}:${hashForCacheKey(baseBranch)}:${hashForCacheKey(compareRef)}`;
}
