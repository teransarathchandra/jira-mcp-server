// ── Inline shape (mirrors LinkedIssueContext from issueContextService) ─────────
// Declared inline to avoid circular import.

interface LinkedIssueContext {
  key: string;
  relationship: string;
  summary: string;
  status: string;
  type: string;
  descriptionSnippet: string | null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type RelevanceLevel = 'high' | 'medium' | 'low' | 'noise';

export interface ScoredLinkedIssue {
  key: string;
  summary: string;
  status: string;
  type: string;
  relationship: string;
  relevanceLevel: RelevanceLevel;
  score: number;
  reasons: string[];
  descriptionSnippet: string | null;
}

export interface RelevanceScoringResult {
  high: ScoredLinkedIssue[];
  medium: ScoredLinkedIssue[];
  low: ScoredLinkedIssue[];
  omittedCount: number;
  omissionReason: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'can', 'not', 'no', 'it',
  'its', 'this', 'that', 'these', 'those', 'i', 'we', 'you', 'he', 'she',
  'they', 'their', 'our', 'your', 'my', 'so', 'if', 'then', 'when',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s,.:;!?()\[\]{}"'`\/\\|-]+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t)),
  );
}

function sharedKeywordCount(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  let count = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) count++;
  }
  return count;
}

function isClosedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'done' || s === 'closed' || s === 'resolved';
}

function isBlockingRelationship(rel: string): boolean {
  const r = rel.toLowerCase();
  return (
    r === 'blocks' ||
    r === 'is blocked by' ||
    r === 'depends on' ||
    r === 'prerequisite'
  );
}

function isDuplicateRelationship(rel: string): boolean {
  const r = rel.toLowerCase();
  return r === 'duplicates' || r === 'is duplicated by';
}

function isRelatesToRelationship(rel: string): boolean {
  return rel.toLowerCase() === 'relates to';
}

function computeRelevanceLevel(
  score: number,
  status: string,
  relationship: string,
): RelevanceLevel {
  // Noise: score < 10 OR (status is done AND relationship is "relates to")
  if (score < 10 || (isClosedStatus(status) && isRelatesToRelationship(relationship))) {
    return 'noise';
  }
  if (score < 25) {
    return 'low';
  }
  if (score < 50) {
    return 'medium';
  }
  return 'high';
}

// ── Main function ─────────────────────────────────────────────────────────────

export function scoreLinkedIssues(params: {
  linkedIssues: LinkedIssueContext[];
  mainSummary: string;
  mainDescription: string;
  mainComponents: string[];
  mainLabels: string[];
  mainTechnicalSignals: string[];
}): RelevanceScoringResult {
  const {
    linkedIssues,
    mainSummary,
    mainDescription,
  } = params;

  if (linkedIssues.length === 0) {
    return {
      high: [],
      medium: [],
      low: [],
      omittedCount: 0,
      omissionReason: null,
    };
  }

  const scored: ScoredLinkedIssue[] = [];

  for (const issue of linkedIssues) {
    let score = 0;
    const reasons: string[] = [];

    // Relationship scoring
    if (isBlockingRelationship(issue.relationship)) {
      score += 30;
      reasons.push('blocking relationship');
    } else if (isDuplicateRelationship(issue.relationship)) {
      score += 25;
      reasons.push('duplicate relationship');
    } else if (isRelatesToRelationship(issue.relationship)) {
      score += 10;
      reasons.push('relates-to relationship');
    }

    // Summary keyword overlap with main summary
    if (sharedKeywordCount(issue.summary, mainSummary) >= 2) {
      score += 15;
      reasons.push('shared keywords in summary');
    }

    // Description snippet keyword overlap with main description
    if (
      issue.descriptionSnippet &&
      sharedKeywordCount(issue.descriptionSnippet, mainDescription) >= 2
    ) {
      score += 10;
      reasons.push('shared keywords in description');
    }

    // Not closed/done/resolved
    if (!isClosedStatus(issue.status)) {
      score += 10;
      reasons.push('issue is open/active');
    }

    // Issue type bonuses
    const typeLower = issue.type.toLowerCase();
    if (typeLower === 'bug') {
      score += 5;
      reasons.push('bug type');
    } else if (
      typeLower === 'story' ||
      typeLower === 'epic' ||
      typeLower === 'task'
    ) {
      score += 5;
      reasons.push('same project domain type');
    }

    // Cap at 100
    const finalScore = Math.min(score, 100);

    const relevanceLevel = computeRelevanceLevel(
      finalScore,
      issue.status,
      issue.relationship,
    );

    scored.push({
      key: issue.key,
      summary: issue.summary,
      status: issue.status,
      type: issue.type,
      relationship: issue.relationship,
      relevanceLevel,
      score: finalScore,
      reasons,
      descriptionSnippet: issue.descriptionSnippet,
    });
  }

  const high = scored.filter((s) => s.relevanceLevel === 'high');
  const medium = scored.filter((s) => s.relevanceLevel === 'medium');
  const low = scored.filter((s) => s.relevanceLevel === 'low');
  const noise = scored.filter((s) => s.relevanceLevel === 'noise');

  const omittedCount = noise.length;
  const omissionReason =
    omittedCount > 0
      ? `${omittedCount} related issue${omittedCount === 1 ? '' : 's'} omitted (weak relevance signals).`
      : null;

  return { high, medium, low, omittedCount, omissionReason };
}

// ── Format function ───────────────────────────────────────────────────────────

export function formatRelevanceSection(result: RelevanceScoringResult): string {
  const hasAny =
    result.high.length > 0 || result.medium.length > 0 || result.low.length > 0;

  if (!hasAny && result.omittedCount === 0) {
    return 'No linked issues.';
  }

  const lines: string[] = ['## Relevant Jira Context'];

  // High relevance
  if (result.high.length > 0) {
    lines.push('', '### High Relevance');
    for (const issue of result.high) {
      const reasonStr = issue.reasons.length > 0 ? issue.reasons.join(', ') : '';
      let line = `- **${issue.key}** (${issue.relationship}): ${issue.summary} — Status: ${issue.status}`;
      if (reasonStr) {
        line += ` | Reason: ${reasonStr}`;
      }
      lines.push(line);
      if (issue.descriptionSnippet) {
        lines.push(`  > ${issue.descriptionSnippet.slice(0, 200)}`);
      }
    }
  }

  // Medium relevance
  if (result.medium.length > 0) {
    lines.push('', '### Medium Relevance');
    for (const issue of result.medium) {
      lines.push(
        `- **${issue.key}** (${issue.relationship}): ${issue.summary} — Status: ${issue.status}`,
      );
    }
  }

  // Low relevance
  if (result.low.length > 0) {
    lines.push('', '### Low Relevance');
    for (const issue of result.low) {
      lines.push(
        `- **${issue.key}** (${issue.relationship}): ${issue.summary} — Status: ${issue.status}`,
      );
    }
  }

  // Omitted
  if (result.omittedCount > 0 && result.omissionReason) {
    lines.push('', '### Omitted Low-Relevance Context');
    lines.push(result.omissionReason);
  }

  return lines.join('\n');
}
