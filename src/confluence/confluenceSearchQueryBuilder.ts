// ── Types ──────────────────────────────────────────────────────────────────────

export interface JiraSearchSignals {
  issueKey: string;             // e.g. "CMPI-1234"
  epicKey?: string;             // e.g. "CMPI-1000"
  parentKey?: string;
  summary: string;
  labels: string[];
  components: string[];
  technicalTerms: string[];     // short list of API names, module names, etc.
  businessTerms: string[];      // domain terms
  linkedIssueSummaries: string[];
  spaceKeys?: string[];          // from CONFLUENCE_SPACE_KEYS config
  confluenceLinks?: string[];    // Confluence URLs found in Jira content
}

export interface CqlQuery {
  cql: string;
  strategy: string;  // human-readable name like "jira-key-search"
}

// ── Stopwords ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "at", "for", "with", "by", "as",
  "this", "that", "it", "its", "and", "or", "but", "not",
]);

// ── Security: CQL value escaping ───────────────────────────────────────────────

/**
 * Escape a value for safe use inside a CQL string literal.
 * - Escapes single quotes: ' -> \'
 * - Removes CQL injection characters: " ` ; ( ) [ ] { }
 * - Trims whitespace
 * - Truncates to max 100 chars
 *
 * IMPORTANT: ALL CQL values MUST go through this function before interpolation.
 */
export function escapeCqlValue(val: string): string {
  // Step 1: escape single quotes
  let result = val.replace(/'/g, "\\'");

  // Step 2: strip injection characters
  result = result.replace(/["`;()[\]{}]/g, "");

  // Step 3: trim
  result = result.trim();

  // Step 4: truncate to 100 chars
  if (result.length > 100) {
    result = result.slice(0, 100);
  }

  return result;
}

// ── Query builders ─────────────────────────────────────────────────────────────

/**
 * Build a CQL query searching full text for the Jira issue key.
 * This is the most targeted query -- it finds pages that explicitly mention
 * the issue key.
 */
export function buildJiraKeyQuery(signals: JiraSearchSignals): CqlQuery {
  const escapedKey = escapeCqlValue(signals.issueKey);
  const cql = 'text ~ "' + escapedKey + '" ORDER BY lastModified DESC';
  return { cql, strategy: "jira-key-search" };
}

/**
 * Build a CQL query searching for the epic or parent key.
 * Returns null if neither epicKey nor parentKey is available.
 */
export function buildEpicParentQuery(
  signals: JiraSearchSignals
): CqlQuery | null {
  const key = signals.epicKey || signals.parentKey;
  if (!key) return null;

  const escapedKey = escapeCqlValue(key);
  const cql =
    'text ~ "' + escapedKey + '" AND type = "page" ORDER BY lastModified DESC';
  return { cql, strategy: "epic-parent-search" };
}

/**
 * Build a CQL query using meaningful words extracted from the issue summary.
 * Returns null if the summary is too short or has fewer than 2 meaningful words.
 */
export function buildSummaryPhraseQuery(
  signals: JiraSearchSignals
): CqlQuery | null {
  const summary = signals.summary.trim();
  if (summary.length < 5) return null;

  // Split into words, lowercase, keep only alphabetic words >= 4 chars that
  // are not stopwords.
  const words = summary
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  if (words.length < 2) return null;

  // Take at most 4 meaningful words.
  const selected = words.slice(0, 4);

  // Build AND-chained title conditions.
  const conditions = selected
    .map((w) => 'title ~ "' + escapeCqlValue(w) + '"')
    .join(" AND ");

  const cql = conditions + ' AND type = "page" ORDER BY lastModified DESC';
  return { cql, strategy: "summary-phrase-search" };
}

/**
 * Build a CQL query using technical terms from the issue.
 * Returns null if there are no technical terms.
 * Takes at most 3 terms to keep the query concise.
 */
export function buildTechnicalTermsQuery(
  signals: JiraSearchSignals
): CqlQuery | null {
  const terms = signals.technicalTerms
    .filter((t) => t.length >= 3)
    .slice(0, 3);

  if (terms.length === 0) return null;

  const conditions = terms
    .map((t) => 'text ~ "' + escapeCqlValue(t) + '"')
    .join(" AND ");

  const cql = conditions + ' AND type = "page" ORDER BY lastModified DESC';
  return { cql, strategy: "technical-terms-search" };
}

/**
 * Wrap a CQL query with a space restriction clause.
 * Returns baseCql unchanged when spaceKeys is empty.
 */
export function buildSpaceRestrictedQuery(
  baseCql: string,
  spaceKeys: string[]
): string {
  if (spaceKeys.length === 0) return baseCql;

  const escapedKeys = spaceKeys.map((k) => escapeCqlValue(k)).join(",");
  return "(" + baseCql + ") AND space.key IN (" + escapedKeys + ")";
}

/**
 * Build all applicable CQL queries for the given signals.
 * - Deduplicates by CQL string
 * - Applies space restriction if spaceKeys configured
 * - Returns at most 5 queries
 * - Always starts with the jira-key-search query
 */
export function buildAllQueries(signals: JiraSearchSignals): CqlQuery[] {
  const spaceKeys = signals.spaceKeys ?? [];

  // Collect all queries (jiraKeyQuery is always first)
  const candidates: CqlQuery[] = [];

  const jiraKeyQuery = buildJiraKeyQuery(signals);
  candidates.push(jiraKeyQuery);

  const epicParentQuery = buildEpicParentQuery(signals);
  if (epicParentQuery) candidates.push(epicParentQuery);

  const summaryPhraseQuery = buildSummaryPhraseQuery(signals);
  if (summaryPhraseQuery) candidates.push(summaryPhraseQuery);

  const technicalTermsQuery = buildTechnicalTermsQuery(signals);
  if (technicalTermsQuery) candidates.push(technicalTermsQuery);

  // Apply space restriction to each query
  const restricted: CqlQuery[] = candidates.map((q) => ({
    cql: buildSpaceRestrictedQuery(q.cql, spaceKeys),
    strategy: q.strategy,
  }));

  // Deduplicate by CQL string, preserving order
  const seen = new Set<string>();
  const deduped: CqlQuery[] = [];
  for (const q of restricted) {
    if (!seen.has(q.cql)) {
      seen.add(q.cql);
      deduped.push(q);
    }
  }

  // Return at most 5 queries
  return deduped.slice(0, 5);
}

// ── Confluence link parsing ────────────────────────────────────────────────────

/**
 * Extract Confluence page IDs from a list of Confluence URLs.
 * Matches patterns:
 *   - /pages/{id}/
 *   - /pages/{id}?...
 *   - /pages/{id} (end of string)
 *   - /wiki/spaces/{space}/pages/{id}
 *
 * Returns a deduplicated list of numeric page ID strings.
 */
export function extractPageIdsFromLinks(urls: string[]): string[] {
  const pageIdPattern = /\/pages\/(\d+)(?:[/?#]|$)/;

  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    const match = pageIdPattern.exec(url);
    if (match) {
      const id = match[1];
      // Only include numeric IDs (pattern already ensures this, but be explicit)
      if (/^\d+$/.test(id) && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }

  return result;
}
