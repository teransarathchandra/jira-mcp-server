import type { MatchResult } from './prRequirementMatcher.js';
import type { RequirementSignals } from './requirementExtractor.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type AlignmentStatus =
  | 'STRONGLY_ALIGNED'
  | 'MOSTLY_ALIGNED'
  | 'PARTIALLY_ALIGNED'
  | 'WEAKLY_ALIGNED'
  | 'NOT_ENOUGH_EVIDENCE';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export interface ScoreBreakdown {
  acCoverageScore: number;       // 0-40
  technicalSignalScore: number;  // 0-20
  relevantFilesScore: number;    // 0-15
  testCoverageScore: number;     // 0-15
  noiseScore: number;            // 0-10
}

export interface AlignmentResult {
  status: AlignmentStatus;
  score: number;          // 0-100
  confidence: ConfidenceLevel;
  scoreBreakdown: ScoreBreakdown;
  penalties: string[];    // list of reasons score was reduced
}

export interface ScoringInput {
  matchResult: MatchResult;
  requirementSignals: RequirementSignals;
  jiraContextQualityScore: number;   // 0-100, from existing contextQualityScorer (0 if unknown)
  diffTruncated: boolean;
  totalChangedFileCount: number;
  hasBackendRequirement: boolean;    // Jira says backend change needed
  hasFrontendRequirement: boolean;   // Jira says frontend change needed
}

// ── Component scoring helpers ──────────────────────────────────────────────────

function scoreAcCoverage(
  matchResult: MatchResult,
  penalties: string[],
): number {
  const total = matchResult.coverageItems.length;

  if (total === 0) {
    penalties.push('No explicit acceptance criteria in Jira');
    return 20;
  }

  const covered = matchResult.coverageItems.filter(i => i.status === 'covered').length;
  const partial = matchResult.coverageItems.filter(i => i.status === 'partial').length;
  const ratio = (covered + partial * 0.5) / total;

  return Math.round(ratio * 40);
}

function scoreTechnicalSignals(matchResult: MatchResult): number {
  const { technicalSignalMatchCount, technicalSignalTotalCount } = matchResult;

  if (technicalSignalTotalCount === 0) {
    return 10; // neutral — not penalized but not full credit
  }

  const ratio = technicalSignalMatchCount / technicalSignalTotalCount;

  if (ratio >= 0.75) return 20;
  if (ratio >= 0.5) return 14;
  if (ratio >= 0.25) return 8;
  return 3;
}

function scoreRelevantFiles(
  matchResult: MatchResult,
  totalChangedFileCount: number,
  penalties: string[],
): number {
  if (totalChangedFileCount === 0) {
    return 0;
  }

  const unrelatedRatio = matchResult.unrelatedChanges.length / totalChangedFileCount;

  if (unrelatedRatio > 0.3) {
    penalties.push('Many unrelated file changes detected');
  }

  if (unrelatedRatio <= 0.1) return 15;
  if (unrelatedRatio <= 0.2) return 12;
  if (unrelatedRatio <= 0.35) return 8;
  if (unrelatedRatio <= 0.5) return 4;
  return 0;
}

function scoreTestCoverage(
  matchResult: MatchResult,
  penalties: string[],
): number {
  switch (matchResult.testCoverageSignal) {
    case 'tests_added':
      return 15;
    case 'tests_modified':
      return 12;
    case 'tests_in_unrelated_areas':
      return 5;
    case 'only_snapshots_changed':
      return 3;
    case 'no_test_changes':
      penalties.push('No test changes detected');
      return 0;
  }
}

function scoreNoise(
  input: ScoringInput,
  penalties: string[],
): number {
  let score = 10;

  if (input.diffTruncated) {
    score -= 5;
    penalties.push('Diff truncated — alignment confidence reduced');
  }

  if (input.matchResult.riskyChangePaths.length > 0) {
    score -= 3;
    penalties.push('Risky file changes detected');
  }

  if (input.requirementSignals.ambiguities.length > 0) {
    score -= 2;
    penalties.push('Unresolved requirement ambiguities');
  }

  return Math.max(0, score);
}

// ── Status & confidence helpers ────────────────────────────────────────────────

function deriveStatus(score: number): AlignmentStatus {
  if (score >= 80) return 'STRONGLY_ALIGNED';
  if (score >= 65) return 'MOSTLY_ALIGNED';
  if (score >= 45) return 'PARTIALLY_ALIGNED';
  if (score >= 25) return 'WEAKLY_ALIGNED';
  return 'NOT_ENOUGH_EVIDENCE';
}

function deriveConfidence(
  jiraContextQualityScore: number,
  diffTruncated: boolean,
  technicalSignalTotalCount: number,
): ConfidenceLevel {
  if (
    jiraContextQualityScore >= 70 &&
    !diffTruncated &&
    technicalSignalTotalCount >= 3
  ) {
    return 'High';
  }

  if (jiraContextQualityScore >= 40 && !diffTruncated) {
    return 'Medium';
  }

  return 'Low';
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Score the alignment between a PR's changes and the Jira issue requirements.
 * Pure, deterministic — no I/O side-effects.
 */
export function scoreAlignment(input: ScoringInput): AlignmentResult {
  const { matchResult, requirementSignals, jiraContextQualityScore, diffTruncated, totalChangedFileCount } = input;
  const penalties: string[] = [];

  // ── Compute component scores ──────────────────────────────────────────────

  const acCoverageScore = scoreAcCoverage(matchResult, penalties);
  const technicalSignalScore = scoreTechnicalSignals(matchResult);
  const relevantFilesScore = scoreRelevantFiles(matchResult, totalChangedFileCount, penalties);
  const testCoverageScore = scoreTestCoverage(matchResult, penalties);
  const noiseScore = scoreNoise(input, penalties);

  const scoreBreakdown: ScoreBreakdown = {
    acCoverageScore,
    technicalSignalScore,
    relevantFilesScore,
    testCoverageScore,
    noiseScore,
  };

  // ── Sum components ────────────────────────────────────────────────────────

  let score =
    acCoverageScore +
    technicalSignalScore +
    relevantFilesScore +
    testCoverageScore +
    noiseScore;

  // ── Cross-cutting flat penalties ──────────────────────────────────────────

  if (jiraContextQualityScore < 40) {
    score -= 5;
    penalties.push('Jira context quality too low for reliable scoring');
  }

  if (input.hasBackendRequirement && !matchResult.hasBackendChanges) {
    score -= 8;
    penalties.push('Jira requires backend changes but no backend files changed');
  }

  if (input.hasFrontendRequirement && !matchResult.hasFrontendChanges) {
    score -= 8;
    penalties.push('Jira requires frontend changes but no frontend files changed');
  }

  score = Math.max(0, score);

  // ── Status determination ──────────────────────────────────────────────────

  let status = deriveStatus(score);

  // NOT_ENOUGH_EVIDENCE override
  if (
    totalChangedFileCount === 0 ||
    (matchResult.technicalSignalTotalCount === 0 && matchResult.coverageItems.length === 0) ||
    (diffTruncated && score < 30)
  ) {
    status = 'NOT_ENOUGH_EVIDENCE';
  }

  // ── Confidence level ──────────────────────────────────────────────────────

  const confidence = deriveConfidence(
    jiraContextQualityScore,
    diffTruncated,
    matchResult.technicalSignalTotalCount,
  );

  return {
    status,
    score,
    confidence,
    scoreBreakdown,
    penalties,
  };
}
