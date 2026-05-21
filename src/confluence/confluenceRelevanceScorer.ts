import { isStaleOrDeprecated } from "./confluenceContentConverter.js";
import type { ConfluenceSignals } from "./confluenceContentConverter.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type RelevanceLevel =
  | "HIGH_RELEVANCE"
  | "MEDIUM_RELEVANCE"
  | "LOW_RELEVANCE"
  | "OMIT";

export interface RelevanceScorerInput {
  pageId: string;
  pageTitle: string;
  pageLabels: string[];
  spaceKey: string;
  lastModified: string; // ISO date string
  pageBodyMarkdown: string;
  signals: ConfluenceSignals; // from confluenceContentConverter
  jiraIssueKey: string;
  jiraEpicKey?: string;
  jiraParentKey?: string;
  jiraSummary: string;
  jiraLabels: string[];
  jiraComponents: string[];
  jiraTechnicalTerms: string[];
  directlyLinkedFromJira: boolean;
  allowedSpaceKeys: string[];
  labelBoosts: string[];
  excludeLabels: string[];
  titleBoostTerms: string[];
}

export interface RelevanceScore {
  level: RelevanceLevel;
  score: number; // 0-100 raw score (before cap)
  reasons: string[];
  isStale: boolean;
  staleWarning?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Case-insensitive substring check */
function containsCI(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

/** Case-insensitive set intersection */
function intersectsCI(setA: string[], setB: string[]): boolean {
  const lowerB = new Set(setB.map((s) => s.toLowerCase()));
  return setA.some((a) => lowerB.has(a.toLowerCase()));
}

/** Words from a string, lowercased, length >= 4 */
function longWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 4);
}

/** Count how many terms appear in text (case-insensitive) */
function countTermsInText(terms: string[], text: string): number {
  const lowerText = text.toLowerCase();
  return terms.filter((t) => lowerText.includes(t.toLowerCase())).length;
}

/** Determine level from score */
function scoreToLevel(score: number): RelevanceLevel {
  if (score >= 50) return "HIGH_RELEVANCE";
  if (score >= 25) return "MEDIUM_RELEVANCE";
  if (score >= 10) return "LOW_RELEVANCE";
  return "OMIT";
}

// ── scorePageRelevance ────────────────────────────────────────────────────────

/**
 * Score a Confluence page for relevance to a Jira issue.
 * Pure function — no I/O, no side effects.
 */
export function scorePageRelevance(
  input: RelevanceScorerInput
): RelevanceScore {
  const {
    pageTitle,
    pageLabels,
    spaceKey,
    lastModified,
    pageBodyMarkdown,
    jiraIssueKey,
    jiraEpicKey,
    jiraParentKey,
    jiraSummary,
    jiraLabels,
    jiraComponents,
    jiraTechnicalTerms,
    directlyLinkedFromJira,
    allowedSpaceKeys,
    labelBoosts,
    excludeLabels,
    titleBoostTerms,
  } = input;

  let score = 0;
  const reasons: string[] = [];

  // ── POSITIVE points ──────────────────────────────────────────────────────────

  // +40 if page body includes exact jiraIssueKey (case-insensitive)
  if (containsCI(pageBodyMarkdown, jiraIssueKey)) {
    score += 40;
    reasons.push(`page body contains Jira issue key "${jiraIssueKey}" (+40)`);
  }

  // +30 if directly linked from Jira
  if (directlyLinkedFromJira) {
    score += 30;
    reasons.push("page is directly linked from Jira issue (+30)");
  }

  // +25 if epicKey present in body
  if (jiraEpicKey && containsCI(pageBodyMarkdown, jiraEpicKey)) {
    score += 25;
    reasons.push(
      `page body contains Jira epic key "${jiraEpicKey}" (+25)`
    );
  }

  // +25 if parentKey present in body (can stack with epic)
  if (jiraParentKey && containsCI(pageBodyMarkdown, jiraParentKey)) {
    score += 25;
    reasons.push(
      `page body contains Jira parent key "${jiraParentKey}" (+25)`
    );
  }

  // +20 if pageTitle has 2+ long words from jiraSummary
  const summaryWords = longWords(jiraSummary);
  const titleLower = pageTitle.toLowerCase();
  const matchedSummaryWords = summaryWords.filter((w) =>
    titleLower.includes(w)
  );
  if (matchedSummaryWords.length >= 2) {
    score += 20;
    reasons.push(
      `page title shares 2+ words with Jira summary (${matchedSummaryWords.slice(0, 3).join(", ")}) (+20)`
    );
  }

  // +15 if pageLabels intersects with jiraLabels
  if (intersectsCI(pageLabels, jiraLabels)) {
    score += 15;
    reasons.push("page labels match Jira issue labels (+15)");
  }

  // +15 if pageLabels intersects with jiraComponents
  if (intersectsCI(pageLabels, jiraComponents)) {
    score += 15;
    reasons.push("page labels match Jira issue components (+15)");
  }

  // +15 if any pageLabel is in labelBoosts
  if (intersectsCI(pageLabels, labelBoosts)) {
    score += 15;
    reasons.push("page has a label-boost label (+15)");
  }

  // +10 if any titleBoostTerm appears in pageTitle
  const titleBoostMatched = titleBoostTerms.some((t) =>
    containsCI(pageTitle, t)
  );
  if (titleBoostMatched) {
    score += 10;
    reasons.push("page title contains a title-boost term (+10)");
  }

  // +10 if 2+ jiraTechnicalTerms appear in pageBodyMarkdown
  const techTermCount = countTermsInText(jiraTechnicalTerms, pageBodyMarkdown);
  if (techTermCount >= 2) {
    score += 10;
    reasons.push(
      `page body contains ${techTermCount} Jira technical terms (+10)`
    );
  }

  // +5 if spaceKey is in allowedSpaceKeys
  const spaceAllowed = allowedSpaceKeys.some(
    (k) => k.toLowerCase() === spaceKey.toLowerCase()
  );
  if (spaceAllowed) {
    score += 5;
    reasons.push(`space key "${spaceKey}" is in allowed spaces (+5)`);
  }

  // +5 if lastModified is within 90 days
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const modifiedDate = new Date(lastModified).getTime();
  if (!isNaN(modifiedDate) && Date.now() - modifiedDate <= ninetyDaysMs) {
    score += 5;
    reasons.push("page was updated within the last 90 days (+5)");
  }

  // ── NEGATIVE points ──────────────────────────────────────────────────────────

  // -30 if isStaleOrDeprecated
  const isStale = isStaleOrDeprecated(
    pageTitle,
    pageLabels,
    pageBodyMarkdown.slice(0, 200)
  );
  if (isStale) {
    score -= 30;
    reasons.push("page appears stale or deprecated (-30)");
  }

  // -20 if any excludeLabel is in pageLabels
  if (intersectsCI(pageLabels, excludeLabels)) {
    score -= 20;
    reasons.push("page has an excluded label (-20)");
  }

  // Clamp score to minimum of 0
  const clampedScore = Math.max(0, score);

  const level = scoreToLevel(clampedScore);

  const result: RelevanceScore = {
    level,
    score: clampedScore,
    reasons,
    isStale,
  };

  if (isStale) {
    result.staleWarning =
      "This page may be stale, deprecated, or archived. Verify its currency before use.";
  }

  return result;
}
