import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { getConfluenceConfig } from '../confluence/confluenceConfig.js';
import { ConfluenceClient } from '../confluence/confluenceClient.js';
import { fetchConfluenceContext, type ConfluenceContextOptions } from '../confluence/confluenceContextService.js';
import { formatRelatedPagesOutput } from '../confluence/formatConfluenceSummary.js';
import { adfToMarkdown } from '../utils/adfToMarkdown.js';

export interface ConfluenceSearchRelatedPagesInput {
  issueKey: string;
  maxResults?: number;
  spaceKeys?: string[];
  includeLowRelevance?: boolean;
}

export async function confluenceSearchRelatedPages(
  input: ConfluenceSearchRelatedPagesInput,
  jiraClient: JiraClient,
  config: Config
): Promise<string> {
  validateIssueKey(input.issueKey);

  const confluenceConfig = getConfluenceConfig();
  if (!confluenceConfig) {
    return 'Confluence is not configured. Set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN to enable Confluence integration.';
  }

  // Fetch main Jira issue
  const issue = await jiraClient.getIssue(input.issueKey);

  // Extract search signals from the issue
  const jiraSummary: string = issue.fields.summary;
  const jiraLabels: string[] = issue.fields.labels ?? [];
  const jiraComponents: string[] = (issue.fields.components ?? []).map((c: { name: string }) => c.name);

  // Extract technical terms from description (words >= 6 chars)
  const descriptionMarkdown = adfToMarkdown(issue.fields.description);
  const technicalTerms: string[] = descriptionMarkdown
    ? Array.from(
        new Set(
          descriptionMarkdown
            .split(/\s+/)
            .map(w => w.replace(/[^a-zA-Z0-9_-]/g, ''))
            .filter(w => w.length >= 6)
        )
      ).slice(0, 20)
    : [];

  const parentKey: string | undefined = issue.fields.parent?.key;

  const epicFieldId = config.epicFieldId ?? 'customfield_10014';
  const epicFieldValue = (issue.fields as unknown as Record<string, unknown>)[epicFieldId];
  const epicKey: string | undefined =
    epicFieldValue !== null &&
    epicFieldValue !== undefined &&
    typeof epicFieldValue === 'object' &&
    'key' in epicFieldValue &&
    typeof (epicFieldValue as { key: unknown }).key === 'string'
      ? (epicFieldValue as { key: string }).key
      : undefined;

  // Extract Confluence URLs from description markdown
  const confluenceLinks: string[] = descriptionMarkdown
    ? (descriptionMarkdown.match(/https?:\/\/[^\s]+atlassian\.net\/wiki\/[^\s]+/g) ?? [])
    : [];

  const confluenceClient = new ConfluenceClient(confluenceConfig);

  const options: ConfluenceContextOptions = {
    jiraIssueKey: input.issueKey,
    jiraEpicKey: epicKey,
    jiraParentKey: parentKey,
    jiraSummary,
    jiraLabels,
    jiraComponents,
    jiraTechnicalTerms: technicalTerms,
    jiraBusinessTerms: [],
    jiraLinkedIssueSummaries: [],
    confluenceLinksFromJira: confluenceLinks,
    maxSearchResults: input.maxResults ?? confluenceConfig.maxSearchResults,
    maxPagesToRead: confluenceConfig.maxPagesToRead,
    maxPageChars: confluenceConfig.maxPageChars,
    includeMediumRelevance: true,
    includeLowRelevance: input.includeLowRelevance ?? false,
  };

  // Override spaceKeys if provided
  if (input.spaceKeys && input.spaceKeys.length > 0) {
    const overriddenConfig = { ...confluenceConfig, spaceKeys: input.spaceKeys };
    const overriddenClient = new ConfluenceClient(overriddenConfig);
    const context = await fetchConfluenceContext(options, overriddenClient, overriddenConfig);
    return formatRelatedPagesOutput(context, input.issueKey);
  }

  const context = await fetchConfluenceContext(options, confluenceClient, confluenceConfig);
  return formatRelatedPagesOutput(context, input.issueKey);
}
