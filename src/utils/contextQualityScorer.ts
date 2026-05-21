// ── Types ─────────────────────────────────────────────────────────────────────

export interface QualityScoreResult {
  score: number;            // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  interpretation: string;   // one sentence
  breakdown: {
    descriptionScore: number;    // 0-20
    acScore: number;             // 0-25
    commentScore: number;        // 0-15
    technicalScore: number;      // 0-15
    contextScore: number;        // 0-15 (parent+epic+linked)
    conflictPenalty: number;     // 0 to -20
    ambiguityPenalty: number;    // 0 to -15
    blockerPenalty: number;      // 0 or -20
  };
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function scoreDescription(description: string): number {
  const len = description.trim().length;
  if (len === 0) return 0;
  if (len <= 100) return 10;
  if (len <= 300) return 15;
  return 20;
}

function scoreAC(hasAC: boolean, count: number): number {
  if (!hasAC || count === 0) return 0;
  if (count === 1) return 15;
  if (count === 2) return 20;
  return 25;
}

function scoreComments(usefulCount: number): number {
  if (usefulCount === 0) return 0;
  if (usefulCount === 1) return 8;
  if (usefulCount <= 3) return 12;
  return 15;
}

function scoreTechnical(signalCount: number): number {
  if (signalCount === 0) return 0;
  if (signalCount <= 2) return 8;
  if (signalCount <= 4) return 12;
  return 15;
}

function scoreContext(
  hasParent: boolean,
  hasEpic: boolean,
  linkedHighRelevanceCount: number,
): number {
  let score = 0;
  if (hasParent) score += 5;
  if (hasEpic) score += 5;
  if (linkedHighRelevanceCount >= 1) score += 5;
  return score;
}

function calcConflictPenalty(conflictCount: number): number {
  return Math.max(-8 * conflictCount, -20);
}

function calcAmbiguityPenalty(ambiguityCount: number): number {
  return Math.max(-5 * ambiguityCount, -15);
}

function calcBlockerPenalty(hasBlockingIssues: boolean): number {
  return hasBlockingIssues ? -20 : 0;
}

function deriveGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 45) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

function deriveInterpretation(grade: 'A' | 'B' | 'C' | 'D' | 'F'): string {
  switch (grade) {
    case 'A': return 'Excellent context — high confidence implementation brief.';
    case 'B': return 'Good context — proceed with implementation.';
    case 'C': return 'Adequate context — some details may need clarification.';
    case 'D': return 'Limited context — significant gaps present.';
    case 'F': return 'Insufficient context — seek clarification before implementing.';
  }
}

// ── Main function ─────────────────────────────────────────────────────────────

export function scoreContextQuality(params: {
  mainDescription: string;
  hasAcceptanceCriteria: boolean;
  acceptanceCriteriaCount: number;
  usefulCommentCount: number;
  technicalSignalCount: number;
  hasParentContext: boolean;
  hasEpicContext: boolean;
  linkedHighRelevanceCount: number;
  conflictCount: number;
  ambiguityCount: number;
  hasBlockingIssues: boolean;
}): QualityScoreResult {
  const {
    mainDescription,
    hasAcceptanceCriteria,
    acceptanceCriteriaCount,
    usefulCommentCount,
    technicalSignalCount,
    hasParentContext,
    hasEpicContext,
    linkedHighRelevanceCount,
    conflictCount,
    ambiguityCount,
    hasBlockingIssues,
  } = params;

  const descriptionScore = scoreDescription(mainDescription);
  const acScore = scoreAC(hasAcceptanceCriteria, acceptanceCriteriaCount);
  const commentScore = scoreComments(usefulCommentCount);
  const technicalScore = scoreTechnical(technicalSignalCount);
  const contextScore = scoreContext(hasParentContext, hasEpicContext, linkedHighRelevanceCount);
  const conflictPenalty = calcConflictPenalty(conflictCount);
  const ambiguityPenalty = calcAmbiguityPenalty(ambiguityCount);
  const blockerPenalty = calcBlockerPenalty(hasBlockingIssues);

  const raw =
    descriptionScore +
    acScore +
    commentScore +
    technicalScore +
    contextScore +
    conflictPenalty +
    ambiguityPenalty +
    blockerPenalty;

  const score = Math.max(0, Math.min(100, raw));
  const grade = deriveGrade(score);
  const interpretation = deriveInterpretation(grade);

  return {
    score,
    grade,
    interpretation,
    breakdown: {
      descriptionScore,
      acScore,
      commentScore,
      technicalScore,
      contextScore,
      conflictPenalty,
      ambiguityPenalty,
      blockerPenalty,
    },
  };
}

// ── Format function ───────────────────────────────────────────────────────────

export function formatQualitySection(result: QualityScoreResult): string {
  return [
    '## Context Quality',
    `**Score:** ${result.score}/100 (${result.grade})`,
    '',
    `Interpretation: ${result.interpretation}`,
  ].join('\n');
}
