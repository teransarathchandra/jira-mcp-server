import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { getConfluenceConfig } from '../confluence/confluenceConfig.js';
import { ConfluenceClient } from '../confluence/confluenceClient.js';
import {
  confluenceHtmlToMarkdown,
  extractConfluenceSections,
  extractConfluenceSignals,
  isStaleOrDeprecated,
} from '../confluence/confluenceContentConverter.js';
import { rankPageAuthority, type AuthorityRankerInput } from '../confluence/confluenceAuthorityRanker.js';
import { formatPageSummaryOutput } from '../confluence/formatConfluenceSummary.js';
import type { ConfluencePageSummary } from '../confluence/confluenceContextService.js';

export interface ConfluenceGetPageSummaryInput {
  pageId: string;
  maxChars?: number;
}

export async function confluenceGetPageSummary(
  input: ConfluenceGetPageSummaryInput,
  _jiraClient: JiraClient,
  _config: Config
): Promise<string> {
  if (!input.pageId?.trim()) {
    return 'Invalid page ID: pageId is required.';
  }

  const confluenceConfig = getConfluenceConfig();
  if (!confluenceConfig) {
    return 'Confluence is not configured. Set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN to enable Confluence integration.';
  }

  const maxChars = input.maxChars ?? confluenceConfig.maxPageChars;

  const client = new ConfluenceClient(confluenceConfig);
  const page = await client.getPageById(input.pageId);

  const html = page.body?.view?.value ?? page.body?.storage?.value ?? '';
  let markdown = confluenceHtmlToMarkdown(html);

  const bodyTruncated = markdown.length > maxChars;
  if (bodyTruncated) {
    markdown = markdown.slice(0, maxChars);
  }

  const sections = extractConfluenceSections(markdown);
  const signals = extractConfluenceSignals(markdown);
  const labels = page.metadata.labels.results.map(l => l.name);
  const isStale = isStaleOrDeprecated(page.title, labels, markdown.slice(0, 200));
  const url = client.getPageUrl(page);

  const authorityInput: AuthorityRankerInput = {
    pageTitle: page.title,
    pageLabels: labels,
    spaceKey: page.space.key,
    lastModified: page.version.when,
    pageBodyMarkdown: markdown,
    sections,
    directlyLinkedFromJira: false,
    isStale,
    allowedSpaceKeys: confluenceConfig.spaceKeys,
  };

  const authorityResult = rankPageAuthority(authorityInput);

  const pageSummary: ConfluencePageSummary = {
    pageId: page.id,
    title: page.title,
    url,
    space: page.space.name,
    spaceKey: page.space.key,
    lastUpdated: page.version.when,
    version: page.version.number,
    labels,
    relevanceLevel: 'HIGH_RELEVANCE',
    relevanceScore: 0,
    relevanceReasons: [],
    authorityLevel: authorityResult.level,
    authorityReasons: authorityResult.reasons,
    isStale,
    staleWarning: isStale ? 'Page appears to be stale or deprecated.' : undefined,
    bodyMarkdown: markdown,
    bodyTruncated,
    signals,
    sections,
  };

  return formatPageSummaryOutput(pageSummary);
}
