import type { ConfluenceContext, ConfluencePageSummary } from "./confluenceContextService.js";
import { truncateText } from "../utils/contextBudget.js";

// ── formatRelatedPagesOutput ───────────────────────────────────────────────────

/**
 * Render a Confluence context search result as a human-readable Markdown string.
 */
export function formatRelatedPagesOutput(
  context: ConfluenceContext,
  issueKey: string
): string {
  const lines: string[] = [];

  lines.push(`# Related Confluence Pages for ${issueKey}`);
  lines.push("");

  // ── HIGH RELEVANCE ──────────────────────────────────────────────────────────

  lines.push("## High Relevance");
  lines.push("");

  if (context.highRelevancePages.length === 0) {
    lines.push("No high-relevance pages found.");
  } else {
    for (const page of context.highRelevancePages) {
      lines.push(`- **${page.title}**`);
      lines.push(`  - URL: ${page.url}`);
      lines.push(`  - Space: ${page.space} (${page.spaceKey})`);
      lines.push(`  - Last updated: ${formatDate(page.lastUpdated)}`);
      if (page.relevanceReasons.length > 0) {
        lines.push(`  - Relevance reason: ${page.relevanceReasons.join(", ")}`);
      }
      lines.push(`  - Authority: ${page.authorityLevel}`);
      if (page.isStale && page.staleWarning) {
        lines.push(`  - ⚠️ Warning: ${page.staleWarning}`);
      }
    }
  }
  lines.push("");

  // ── MEDIUM RELEVANCE ────────────────────────────────────────────────────────

  if (context.mediumRelevancePages.length > 0) {
    lines.push("## Medium Relevance");
    lines.push("");
    for (const page of context.mediumRelevancePages) {
      lines.push(`- **${page.title}**`);
      lines.push(`  - URL: ${page.url}`);
      lines.push(`  - Space: ${page.space} (${page.spaceKey})`);
      lines.push(`  - Last updated: ${formatDate(page.lastUpdated)}`);
      if (page.relevanceReasons.length > 0) {
        lines.push(`  - Relevance reason: ${page.relevanceReasons.join(", ")}`);
      }
    }
    lines.push("");
  }

  // ── OMITTED ─────────────────────────────────────────────────────────────────

  const totalOmitted = context.omittedCount + context.lowRelevancePagesCount;
  if (totalOmitted > 0) {
    lines.push("## Omitted");
    lines.push("");
    lines.push(`- ${totalOmitted} low-relevance pages omitted.`);
    lines.push("");
  }

  // ── FOOTER ──────────────────────────────────────────────────────────────────

  lines.push("---");
  lines.push(
    `Searched ${context.pagesSearched} pages total. Read ${context.pagesRead} page bodies.`
  );

  if (context.budgetWarnings.length > 0) {
    lines.push("");
    for (const warn of context.budgetWarnings) {
      lines.push(`⚠️ ${warn}`);
    }
  }

  return lines.join("\n");
}

// ── formatPageSummaryOutput ────────────────────────────────────────────────────

/**
 * Render a single ConfluencePageSummary as a detailed Markdown string.
 */
export function formatPageSummaryOutput(page: ConfluencePageSummary): string {
  const lines: string[] = [];

  lines.push(`# Confluence Page Summary: ${page.title}`);
  lines.push("");

  // ── METADATA ────────────────────────────────────────────────────────────────

  lines.push("## Metadata");
  lines.push(`- Space: ${page.space} (${page.spaceKey})`);
  lines.push(`- Page ID: ${page.pageId}`);
  lines.push(`- URL: ${page.url}`);
  lines.push(`- Last updated: ${formatDate(page.lastUpdated)}`);
  lines.push(`- Version: ${page.version}`);
  lines.push(`- Labels: ${page.labels.length > 0 ? page.labels.join(", ") : "none"}`);
  lines.push(`- Authority: ${page.authorityLevel}`);
  lines.push(`- Staleness warning: ${page.staleWarning ?? "None"}`);
  lines.push("");

  // ── KEY CONTENT ─────────────────────────────────────────────────────────────

  lines.push("## Key Content");
  const contentPreview = truncateText(page.bodyMarkdown, 500);
  lines.push(contentPreview);

  if (page.bodyTruncated) {
    lines.push("");
    lines.push(`⚠️ Page content truncated at ${page.bodyMarkdown.length} chars.`);
  }
  lines.push("");

  // ── SECTIONS ────────────────────────────────────────────────────────────────

  lines.push("## Sections Found");
  if (page.sections.length === 0) {
    lines.push("No sections found.");
  } else {
    for (const section of page.sections) {
      lines.push(`- Level ${section.level}: ${section.heading}`);
    }
  }
  lines.push("");

  // ── SIGNALS ──────────────────────────────────────────────────────────────────

  lines.push("## Key Signals");
  const { signals } = page;
  let hasSignals = false;

  if (signals.apiEndpoints.length > 0) {
    lines.push(`API Endpoints: ${signals.apiEndpoints.join(", ")}`);
    hasSignals = true;
  }
  if (signals.businessRules.length > 0) {
    lines.push(`Business Rules: ${signals.businessRules.join("; ")}`);
    hasSignals = true;
  }
  if (signals.permissions.length > 0) {
    lines.push(`Permissions: ${signals.permissions.join("; ")}`);
    hasSignals = true;
  }
  if (signals.validationRules.length > 0) {
    lines.push(`Validation Rules: ${signals.validationRules.join("; ")}`);
    hasSignals = true;
  }
  if (signals.testingNotes.length > 0) {
    lines.push(`Testing Notes: ${signals.testingNotes.join("; ")}`);
    hasSignals = true;
  }
  if (signals.userRoles.length > 0) {
    lines.push(`User Roles: ${signals.userRoles.join(", ")}`);
    hasSignals = true;
  }
  if (signals.uiScreens.length > 0) {
    lines.push(`UI Screens: ${signals.uiScreens.join("; ")}`);
    hasSignals = true;
  }
  if (signals.tableNames.length > 0) {
    lines.push(`Table Names: ${signals.tableNames.join(", ")}`);
    hasSignals = true;
  }
  if (signals.featureFlags.length > 0) {
    lines.push(`Feature Flags: ${signals.featureFlags.join("; ")}`);
    hasSignals = true;
  }
  if (signals.releaseNotes.length > 0) {
    lines.push(`Release Notes: ${signals.releaseNotes.join("; ")}`);
    hasSignals = true;
  }
  if (signals.knownLimitations.length > 0) {
    lines.push(`Known Limitations: ${signals.knownLimitations.join("; ")}`);
    hasSignals = true;
  }
  if (signals.dependencies.length > 0) {
    lines.push(`Dependencies: ${signals.dependencies.join("; ")}`);
    hasSignals = true;
  }
  if (signals.diagramsMentioned.length > 0) {
    lines.push(`Diagrams Mentioned: ${signals.diagramsMentioned.join("; ")}`);
    hasSignals = true;
  }

  if (!hasSignals) {
    lines.push("No significant signals detected.");
  }
  lines.push("");

  // ── RELATED LINKS ────────────────────────────────────────────────────────────

  lines.push("## Related Links");
  if (signals.relatedPageLinks.length > 0) {
    for (const link of signals.relatedPageLinks) {
      lines.push(`- ${link}`);
    }
  } else {
    lines.push("None found.");
  }

  return lines.join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Format an ISO date string as YYYY-MM-DD.
 * Returns the original string if parsing fails.
 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
