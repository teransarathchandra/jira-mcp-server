import type { ConfluenceConfig } from "./confluenceConfig.js";
import type { ConfluenceClient, ConfluencePage } from "./confluenceClient.js";
import type { JiraSearchSignals } from "./confluenceSearchQueryBuilder.js";
import { buildAllQueries, extractPageIdsFromLinks } from "./confluenceSearchQueryBuilder.js";
import {
  confluenceHtmlToMarkdown,
  extractConfluenceSections,
  extractConfluenceSignals,
  isStaleOrDeprecated,
  type Section,
  type ConfluenceSignals,
} from "./confluenceContentConverter.js";
import {
  scorePageRelevance,
  type RelevanceLevel,
} from "./confluenceRelevanceScorer.js";
import {
  rankPageAuthority,
  type AuthorityLevel,
} from "./confluenceAuthorityRanker.js";
import { dedupByKey, truncateText } from "../utils/contextBudget.js";

// ── Exported types ─────────────────────────────────────────────────────────────

export interface ConfluenceContextOptions {
  jiraIssueKey: string;
  jiraEpicKey?: string;
  jiraParentKey?: string;
  jiraSummary: string;
  jiraLabels: string[];
  jiraComponents: string[];
  jiraTechnicalTerms: string[];
  jiraBusinessTerms: string[];
  jiraLinkedIssueSummaries: string[];
  confluenceLinksFromJira: string[];   // Confluence page URLs found in Jira content
  maxSearchResults?: number;            // default: config.maxSearchResults
  maxPagesToRead?: number;              // default: config.maxPagesToRead
  maxPageChars?: number;                // default: config.maxPageChars
  includeMediumRelevance?: boolean;     // default: true
  includeLowRelevance?: boolean;        // default: false
}

export interface ConfluencePageSummary {
  pageId: string;
  title: string;
  url: string;
  space: string;       // space.name
  spaceKey: string;    // space.key
  lastUpdated: string; // version.when ISO string
  version: number;     // version.number
  labels: string[];    // label names
  relevanceLevel: RelevanceLevel;
  relevanceScore: number;
  relevanceReasons: string[];
  authorityLevel: AuthorityLevel;
  authorityReasons: string[];
  isStale: boolean;
  staleWarning?: string;
  bodyMarkdown: string;  // truncated to maxPageChars
  bodyTruncated: boolean;
  signals: ConfluenceSignals;
  sections: Section[];
}

export interface ConfluenceContext {
  pagesSearched: number;
  pagesRead: number;
  highRelevancePages: ConfluencePageSummary[];
  mediumRelevancePages: ConfluencePageSummary[];
  lowRelevancePagesCount: number;
  omittedCount: number;
  warnings: string[];
  budgetWarnings: string[];
}

// ── Internal type to track enriched page state ────────────────────────────────

interface EnrichedPage {
  page: ConfluencePage;
  directlyLinkedFromJira: boolean;
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Fetch and score Confluence pages relevant to a Jira issue.
 * NEVER throws — all per-page errors are caught and added to warnings.
 */
export async function fetchConfluenceContext(
  options: ConfluenceContextOptions,
  client: ConfluenceClient,
  config: ConfluenceConfig
): Promise<ConfluenceContext> {
  // 1. Apply defaults
  const maxSearchResults = options.maxSearchResults ?? config.maxSearchResults;
  const maxPagesToRead = options.maxPagesToRead ?? config.maxPagesToRead;
  const maxPageChars = options.maxPageChars ?? config.maxPageChars;
  const includeMediumRelevance = options.includeMediumRelevance ?? true;
  const includeLowRelevance = options.includeLowRelevance ?? false;

  const warnings: string[] = [];
  const budgetWarnings: string[] = [];

  // 2. Build JiraSearchSignals
  const signals: JiraSearchSignals = {
    issueKey: options.jiraIssueKey,
    epicKey: options.jiraEpicKey,
    parentKey: options.jiraParentKey,
    summary: options.jiraSummary,
    labels: options.jiraLabels,
    components: options.jiraComponents,
    technicalTerms: options.jiraTechnicalTerms,
    businessTerms: options.jiraBusinessTerms,
    linkedIssueSummaries: options.jiraLinkedIssueSummaries,
    spaceKeys: config.spaceKeys,
    confluenceLinks: options.confluenceLinksFromJira,
  };

  // 3. Build CQL queries and execute each
  const queries = buildAllQueries(signals);
  const enrichedPages: EnrichedPage[] = [];

  for (const query of queries) {
    try {
      const result = await client.searchContentByCql(query.cql, maxSearchResults);
      for (const page of result.results) {
        enrichedPages.push({ page, directlyLinkedFromJira: false });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Confluence search query "${query.strategy}" failed: ${msg}`);
    }
  }

  // 4. Fetch directly linked pages from Jira
  const linkedPageIds = extractPageIdsFromLinks(options.confluenceLinksFromJira);
  for (const pageId of linkedPageIds) {
    try {
      const page = await client.getPageById(pageId);
      enrichedPages.push({ page, directlyLinkedFromJira: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not fetch Confluence page ${pageId} (linked from Jira): ${msg}`);
    }
  }

  // 5. Deduplicate by pageId — linked pages win over search results via priority
  // We want directlyLinkedFromJira=true to win if a page appears in both sets,
  // so put linked pages first in a merge, then dedup keeping first occurrence.
  // Partition into linked vs search-found, then concat linked first.
  const linked = enrichedPages.filter((e) => e.directlyLinkedFromJira);
  const fromSearch = enrichedPages.filter((e) => !e.directlyLinkedFromJira);
  const allEnriched = dedupByKey(
    [...linked, ...fromSearch],
    (e) => e.page.id
  );

  const pagesSearched = allEnriched.length;

  // 6. Score and build page summaries
  let pagesRead = 0;
  const summaries: ConfluencePageSummary[] = [];

  for (const { page, directlyLinkedFromJira } of allEnriched) {
    try {
      // 6a. Get or fetch HTML body
      let html = page.body?.view?.value ?? "";

      // If body is empty and we haven't hit the read limit, fetch it
      if (html === "" && pagesRead < maxPagesToRead) {
        try {
          html = await client.getPageBody(page.id);
          pagesRead++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Could not read body for page "${page.title}" (${page.id}): ${msg}`);
        }
      } else if (html !== "") {
        // Body was already fetched (via getPageById for directly linked pages)
        pagesRead++;
      }

      // 6b. Convert to markdown
      const markdownFull = confluenceHtmlToMarkdown(html);

      // 6c. Truncate to maxPageChars
      const markdownTruncated = truncateText(markdownFull, maxPageChars);
      const bodyTruncated = markdownFull.length > maxPageChars;

      // 6d. Extract sections and signals
      const sections = extractConfluenceSections(markdownTruncated);
      const extractedSignals = extractConfluenceSignals(markdownTruncated);

      // 6e. Extract labels
      const labels = page.metadata.labels.results.map((l) => l.name);

      // 6f. Check staleness
      const stale = isStaleOrDeprecated(
        page.title,
        labels,
        markdownTruncated.slice(0, 200)
      );

      // 6g. Build page URL
      const url = client.getPageUrl(page);

      // 6h. Score relevance
      const relevanceResult = scorePageRelevance({
        pageId: page.id,
        pageTitle: page.title,
        pageLabels: labels,
        spaceKey: page.space.key,
        lastModified: page.version.when,
        pageBodyMarkdown: markdownTruncated,
        signals: extractedSignals,
        jiraIssueKey: options.jiraIssueKey,
        jiraEpicKey: options.jiraEpicKey,
        jiraParentKey: options.jiraParentKey,
        jiraSummary: options.jiraSummary,
        jiraLabels: options.jiraLabels,
        jiraComponents: options.jiraComponents,
        jiraTechnicalTerms: options.jiraTechnicalTerms,
        directlyLinkedFromJira,
        allowedSpaceKeys: config.spaceKeys,
        labelBoosts: config.labelBoosts,
        excludeLabels: config.excludeLabels,
        titleBoostTerms: config.titleBoostTerms,
      });

      // 6i. Rank authority
      const authorityResult = rankPageAuthority({
        pageTitle: page.title,
        pageLabels: labels,
        spaceKey: page.space.key,
        lastModified: page.version.when,
        pageBodyMarkdown: markdownTruncated,
        sections,
        directlyLinkedFromJira,
        isStale: stale,
        allowedSpaceKeys: config.spaceKeys,
      });

      // 6j. Build summary
      const summary: ConfluencePageSummary = {
        pageId: page.id,
        title: page.title,
        url,
        space: page.space.name,
        spaceKey: page.space.key,
        lastUpdated: page.version.when,
        version: page.version.number,
        labels,
        relevanceLevel: relevanceResult.level,
        relevanceScore: relevanceResult.score,
        relevanceReasons: relevanceResult.reasons,
        authorityLevel: authorityResult.level,
        authorityReasons: authorityResult.reasons,
        isStale: stale,
        staleWarning: relevanceResult.staleWarning,
        bodyMarkdown: markdownTruncated,
        bodyTruncated,
        signals: extractedSignals,
        sections,
      };

      summaries.push(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Skipping page "${page.title}" (${page.id}): ${msg}`);
    }
  }

  // 7. Sort: HIGH first, then MEDIUM, then LOW, then OMIT
  const levelOrder: Record<RelevanceLevel, number> = {
    HIGH_RELEVANCE: 0,
    MEDIUM_RELEVANCE: 1,
    LOW_RELEVANCE: 2,
    OMIT: 3,
  };
  summaries.sort(
    (a, b) =>
      levelOrder[a.relevanceLevel] - levelOrder[b.relevanceLevel] ||
      b.relevanceScore - a.relevanceScore
  );

  // 8. Partition into buckets
  const highPages: ConfluencePageSummary[] = [];
  const mediumPages: ConfluencePageSummary[] = [];
  let lowCount = 0;
  let omittedCount = 0;

  for (const summary of summaries) {
    if (summary.relevanceLevel === "OMIT") {
      omittedCount++;
    } else if (summary.relevanceLevel === "HIGH_RELEVANCE") {
      highPages.push(summary);
    } else if (summary.relevanceLevel === "MEDIUM_RELEVANCE") {
      if (includeMediumRelevance) {
        mediumPages.push(summary);
      } else {
        omittedCount++;
      }
    } else if (summary.relevanceLevel === "LOW_RELEVANCE") {
      if (includeLowRelevance) {
        // LOW pages: never read body — clear it
        summary.bodyMarkdown = "";
        summary.bodyTruncated = false;
      } else {
        lowCount++;
      }
    }
  }

  // LOW pages excluded from output (count only)
  omittedCount += 0; // already counted above

  // 9. Budget warnings
  if (pagesSearched > maxSearchResults) {
    budgetWarnings.push(
      `Confluence search returned broad results. Showing top ${maxSearchResults}.`
    );
  }
  if (pagesRead >= maxPagesToRead) {
    const additional = pagesSearched - pagesRead;
    if (additional > 0) {
      budgetWarnings.push(
        `Page read limit (${maxPagesToRead}) reached. ${additional} additional pages omitted.`
      );
    }
  }
  if (highPages.length === 0 && mediumPages.length === 0) {
    budgetWarnings.push(
      `No relevant Confluence pages found for ${options.jiraIssueKey}.`
    );
  }

  return {
    pagesSearched,
    pagesRead,
    highRelevancePages: highPages,
    mediumRelevancePages: mediumPages,
    lowRelevancePagesCount: lowCount,
    omittedCount,
    warnings,
    budgetWarnings,
  };
}
