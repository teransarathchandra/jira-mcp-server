import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { fetchIssueContext, type ContextFetchOptions } from '../jira/issueContextService.js';
import { isConfluenceEnabled, getConfluenceConfig } from '../confluence/confluenceConfig.js';
import { ConfluenceClient } from '../confluence/confluenceClient.js';
import { fetchConfluenceContext, type ConfluenceContextOptions, type ConfluenceContext } from '../confluence/confluenceContextService.js';
import { detectJiraConfluenceConflicts, type ConflictResult } from '../utils/conflictDetector.js';
import { formatJiraConfluenceContextBrief } from '../confluence/formatJiraConfluenceContextBrief.js';
import { adfToMarkdown } from '../utils/adfToMarkdown.js';

export interface JiraGetIssueWithConfluenceContextInput {
  issueKey: string;
  includeJiraComments?: boolean;
  includeParent?: boolean;
  includeEpic?: boolean;
  includeLinkedIssues?: boolean;
  includeSubtasks?: boolean;
  includeConfluence?: boolean;
  confluenceMaxSearchResults?: number;
  confluenceMaxPagesToRead?: number;
  includeMediumRelevancePages?: boolean;
  includeLowRelevancePages?: boolean;
  maxConfluenceChars?: number;
}

export async function jiraGetIssueWithConfluenceContext(
  input: JiraGetIssueWithConfluenceContextInput,
  client: JiraClient,
  config: Config
): Promise<string> {
  validateIssueKey(input.issueKey);

  // Fetch Jira issue context
  const fetchOptions: ContextFetchOptions = {
    includeComments: input.includeJiraComments ?? true,
    includeParent: input.includeParent ?? true,
    includeEpic: input.includeEpic ?? true,
    includeLinkedIssues: input.includeLinkedIssues ?? true,
    includeSubtasks: input.includeSubtasks ?? true,
    includeEpicSiblings: false,
    maxLinkedIssues: 8,
    maxSubtasks: 10,
    maxCommentsPerIssue: 10,
    contextDepth: 1,
  };

  const jiraContext = await fetchIssueContext(input.issueKey, fetchOptions, client, config);

  // Defaults
  const shouldIncludeConfluence = input.includeConfluence ?? true;

  let confluenceContext: ConfluenceContext | null = null;
  let conflicts: ConflictResult = { hasConflicts: false, conflicts: [] };

  if (shouldIncludeConfluence && isConfluenceEnabled()) {
    const confluenceConfig = getConfluenceConfig()!;

    // Extract description markdown
    const descriptionMarkdown = jiraContext.mainIssueDescription;

    // Extract Confluence links from description and comments
    const allTexts: string[] = [descriptionMarkdown];
    for (const comment of jiraContext.mainIssue.fields.comment.comments) {
      allTexts.push(adfToMarkdown(comment.body));
    }

    const confluenceLinks: string[] = [];
    const confluenceLinkRegex = /https?:\/\/[^\s]+atlassian\.net\/wiki\/[^\s]+/g;
    for (const text of allTexts) {
      const matches = text.match(confluenceLinkRegex) ?? [];
      confluenceLinks.push(...matches);
    }

    // Extract technical terms for search signals
    const technicalTerms = descriptionMarkdown
      ? Array.from(
          new Set(
            descriptionMarkdown
              .split(/\s+/)
              .map(w => w.replace(/[^a-zA-Z0-9_-]/g, ''))
              .filter(w => w.length >= 6)
          )
        ).slice(0, 20)
      : [];

    // Extract epic key
    const epicFieldId = config.epicFieldId ?? 'customfield_10014';
    const epicFieldValue = (jiraContext.mainIssue.fields as unknown as Record<string, unknown>)[epicFieldId];
    const epicKey: string | undefined =
      epicFieldValue !== null &&
      epicFieldValue !== undefined &&
      typeof epicFieldValue === 'object' &&
      'key' in epicFieldValue &&
      typeof (epicFieldValue as { key: unknown }).key === 'string'
        ? (epicFieldValue as { key: string }).key
        : (jiraContext.epicIssue?.key ?? undefined);

    // Extract linked issue summaries for better search
    const linkedIssueSummaries = jiraContext.linkedIssues.map(li => li.summary);

    const contextOptions: ConfluenceContextOptions = {
      jiraIssueKey: input.issueKey,
      jiraEpicKey: epicKey,
      jiraParentKey: jiraContext.mainIssue.fields.parent?.key,
      jiraSummary: jiraContext.mainIssue.fields.summary,
      jiraLabels: jiraContext.mainIssue.fields.labels ?? [],
      jiraComponents: (jiraContext.mainIssue.fields.components ?? []).map((c: { name: string }) => c.name),
      jiraTechnicalTerms: technicalTerms,
      jiraBusinessTerms: [],
      jiraLinkedIssueSummaries: linkedIssueSummaries,
      confluenceLinksFromJira: confluenceLinks,
      maxSearchResults: input.confluenceMaxSearchResults ?? confluenceConfig.maxSearchResults,
      maxPagesToRead: input.confluenceMaxPagesToRead ?? confluenceConfig.maxPagesToRead,
      maxPageChars: input.maxConfluenceChars ?? confluenceConfig.maxPageChars,
      includeMediumRelevance: input.includeMediumRelevancePages ?? true,
      includeLowRelevance: input.includeLowRelevancePages ?? false,
    };

    const confluenceClient = new ConfluenceClient(confluenceConfig);
    confluenceContext = await fetchConfluenceContext(contextOptions, confluenceClient, confluenceConfig);

    // Build sources for conflict detection
    const jiraSources: Array<{ label: string; text: string; date?: string }> = [
      {
        label: 'Jira task description',
        text: descriptionMarkdown,
        date: jiraContext.mainIssue.fields.created,
      },
    ];

    for (const comment of jiraContext.mainIssue.fields.comment.comments) {
      const commentText = adfToMarkdown(comment.body);
      if (commentText.trim()) {
        jiraSources.push({
          label: `Jira comment by ${comment.author.displayName}`,
          text: commentText,
          date: comment.created,
        });
      }
    }

    // Build Confluence pages array for conflict detection
    const confluencePages = [
      ...confluenceContext.highRelevancePages,
      ...confluenceContext.mediumRelevancePages,
    ].map(page => ({
      title: page.title,
      bodyMarkdown: page.bodyMarkdown,
      url: page.url,
      isStale: page.isStale,
      lastUpdated: page.lastUpdated,
    }));

    conflicts = detectJiraConfluenceConflicts(jiraSources, confluencePages);
  }

  return formatJiraConfluenceContextBrief(jiraContext, confluenceContext, conflicts);
}
