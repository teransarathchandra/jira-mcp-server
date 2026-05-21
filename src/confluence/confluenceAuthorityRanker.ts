import type { Section } from "./confluenceContentConverter.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AuthorityLevel =
  | "AUTHORITATIVE"
  | "SUPPORTING"
  | "BACKGROUND_ONLY"
  | "STALE_OR_RISKY";

export interface AuthorityRankerInput {
  pageTitle: string;
  pageLabels: string[];
  spaceKey: string;
  lastModified: string;
  pageBodyMarkdown: string;
  sections: Section[]; // from confluenceContentConverter
  directlyLinkedFromJira: boolean;
  isStale: boolean;
  allowedSpaceKeys: string[];
}

export interface AuthorityRank {
  level: AuthorityLevel;
  score: number;
  reasons: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Case-insensitive includes check for a string array */
function arrayContainsCI(arr: string[], term: string): boolean {
  const lowerTerm = term.toLowerCase();
  return arr.some((item) => item.toLowerCase().includes(lowerTerm));
}

// ── rankPageAuthority ─────────────────────────────────────────────────────────

/**
 * Rank the authority of a Confluence page for use as a requirement source.
 * Pure function — no I/O, no side effects.
 */
export function rankPageAuthority(
  input: AuthorityRankerInput
): AuthorityRank {
  const {
    pageTitle,
    pageLabels,
    spaceKey,
    lastModified,
    sections,
    directlyLinkedFromJira,
    isStale,
    allowedSpaceKeys,
  } = input;

  let score = 0;
  const reasons: string[] = [];

  // ── POSITIVE points ──────────────────────────────────────────────────────────

  // +40 if directlyLinkedFromJira
  if (directlyLinkedFromJira) {
    score += 40;
    reasons.push("page is directly linked from Jira issue (+40)");
  }

  // +30 if pageTitle matches PRD/requirements/architecture/etc pattern
  const titleDocPattern =
    /prd|product requirements|technical design|architecture|spec\b|api documentation/i;
  if (titleDocPattern.test(pageTitle)) {
    score += 30;
    reasons.push(
      `page title matches authoritative document pattern (${pageTitle}) (+30)`
    );
  }

  // +20 if any label in ['requirements', 'prd', 'technical-design', 'architecture']
  const authorityLabels = [
    "requirements",
    "prd",
    "technical-design",
    "architecture",
  ];
  const labelsLower = pageLabels.map((l) => l.toLowerCase());
  const hasAuthorityLabel = authorityLabels.some((al) =>
    labelsLower.includes(al)
  );
  if (hasAuthorityLabel) {
    score += 20;
    reasons.push("page has an authority label (requirements/prd/technical-design/architecture) (+20)");
  }

  // +20 if spaceKey is in allowedSpaceKeys (case-insensitive)
  const spaceAllowed = allowedSpaceKeys.some(
    (k) => k.toLowerCase() === spaceKey.toLowerCase()
  );
  if (spaceAllowed) {
    score += 20;
    reasons.push(`space key "${spaceKey}" is in allowed spaces (+20)`);
  }

  // +15 if lastModified within 90 days
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const modifiedDate = new Date(lastModified).getTime();
  if (!isNaN(modifiedDate) && Date.now() - modifiedDate <= ninetyDaysMs) {
    score += 15;
    reasons.push("page was updated within the last 90 days (+15)");
  }

  // +10 if sections has any heading matching requirements/acceptance criteria/etc
  const sectionHeadingPattern =
    /requirements|acceptance criteria|business rules|api|technical design/i;
  const hasMatchingHeading = sections.some((s) =>
    sectionHeadingPattern.test(s.heading)
  );
  if (hasMatchingHeading) {
    score += 10;
    reasons.push(
      "page has a section heading matching requirements/acceptance criteria/business rules/api/technical design (+10)"
    );
  }

  // ── NEGATIVE points ──────────────────────────────────────────────────────────

  // -50 if isStale
  if (isStale) {
    score -= 50;
    reasons.push("page is stale or deprecated (-50)");
  }

  // -20 if any pageLabel or title contains 'deprecated', 'archive', 'draft'
  const riskyTerms = ["deprecated", "archive", "draft"];
  const titleLower = pageTitle.toLowerCase();
  const hasRiskyTitle = riskyTerms.some((t) => titleLower.includes(t));
  const hasRiskyLabel = riskyTerms.some((t) =>
    pageLabels.some((l) => l.toLowerCase().includes(t))
  );
  if (hasRiskyTitle || hasRiskyLabel) {
    score -= 20;
    reasons.push(
      "page title or labels contain deprecated/archive/draft (-20)"
    );
  }

  // ── Level determination ──────────────────────────────────────────────────────

  let level: AuthorityLevel;
  if (isStale) {
    level = "STALE_OR_RISKY";
  } else if (score < 0) {
    level = "STALE_OR_RISKY";
  } else if (score >= 60) {
    level = "AUTHORITATIVE";
  } else if (score >= 30) {
    level = "SUPPORTING";
  } else {
    level = "BACKGROUND_ONLY";
  }

  return { level, score, reasons };
}
