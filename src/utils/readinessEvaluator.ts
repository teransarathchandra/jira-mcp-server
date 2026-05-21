// ── Types ─────────────────────────────────────────────────────────────────────

export type ReadinessStatus = 'READY' | 'MOSTLY_READY' | 'NEEDS_CLARIFICATION' | 'BLOCKED';

export interface ReadinessResult {
  status: ReadinessStatus;
  score: number;          // 0-100 internal score
  reasons: string[];      // human-readable statements
  blockers: string[];     // specific blockers if BLOCKED
  recommendedAction: string;
}

// ── Scoring and evaluation ────────────────────────────────────────────────────

/**
 * Deterministically evaluates whether a Jira ticket has enough information
 * to begin implementation.
 */
export function evaluateReadiness(params: {
  mainDescription: string;
  hasAcceptanceCriteria: boolean;
  acceptanceCriteria: string[];
  technicalSignals: string[];
  ambiguities: string[];
  conflictCount: number;
  hasBlockingIssues: boolean;
  blockerDescriptions: string[];
  usefulCommentCount: number;
  hasRequirementChangingComment: boolean;
  latestCommentIntroducesQuestion: boolean;
  businessRules: string[];
  validationRules: string[];
}): ReadinessResult {
  const {
    mainDescription,
    hasAcceptanceCriteria,
    acceptanceCriteria,
    technicalSignals,
    ambiguities,
    conflictCount,
    hasBlockingIssues,
    blockerDescriptions,
    usefulCommentCount,
    hasRequirementChangingComment,
    latestCommentIntroducesQuestion,
    businessRules,
  } = params;

  // ── Score calculation ──────────────────────────────────────────────────────

  let score = 0;

  // Positive signals
  const descriptionIsMeaningful = mainDescription.trim().length > 100;
  if (descriptionIsMeaningful) score += 20;

  if (hasAcceptanceCriteria) score += 25;
  if (acceptanceCriteria.length >= 2) score += 5;   // bonus
  if (technicalSignals.length >= 1) score += 10;
  if (businessRules.length >= 1) score += 5;
  if (usefulCommentCount >= 1) score += 5;
  if (!latestCommentIntroducesQuestion) score += 5;

  // Negative signals
  const ambiguityPenalty = Math.min(ambiguities.length * 10, 30);
  score -= ambiguityPenalty;

  const conflictPenalty = Math.min(conflictCount * 15, 30);
  score -= conflictPenalty;

  if (latestCommentIntroducesQuestion) score -= 15;

  // ── Reason generation ──────────────────────────────────────────────────────

  const reasons: string[] = [];

  if (mainDescription.trim().length === 0) {
    reasons.push('No description provided — goal is unclear.');
  } else if (descriptionIsMeaningful) {
    reasons.push('Main goal is clear.');
  }

  if (hasAcceptanceCriteria) {
    reasons.push('Explicit acceptance criteria defined.');
  } else if (acceptanceCriteria.length >= 1) {
    reasons.push('Acceptance criteria are partially defined or inferred.');
  } else {
    reasons.push('No acceptance criteria found — expected behavior must be inferred.');
  }

  if (technicalSignals.length > 0) {
    reasons.push(`Technical area identified: ${technicalSignals[0]}.`);
  }

  if (hasRequirementChangingComment) {
    reasons.push('Latest comment clarifies or changes the requirement.');
  }

  if (latestCommentIntroducesQuestion) {
    reasons.push('Latest comment introduces an unresolved question.');
  }

  if (conflictCount > 0) {
    reasons.push('Conflicts detected between information sources.');
  }

  // Ambiguity reasons (max 3)
  const ambiguitySlice = ambiguities.slice(0, 3);
  for (const amb of ambiguitySlice) {
    reasons.push(`Ambiguity: '${amb.slice(0, 60)}'.`);
  }

  // Blocker reasons (max 2)
  const blockerSlice = blockerDescriptions.slice(0, 2);
  for (const blocker of blockerSlice) {
    reasons.push(`Blocker: '${blocker}'.`);
  }

  // ── Status determination ───────────────────────────────────────────────────

  let status: ReadinessStatus;

  if (hasBlockingIssues) {
    status = 'BLOCKED';
  } else if (score >= 70) {
    status = 'READY';
  } else if (score >= 40) {
    status = 'MOSTLY_READY';
  } else {
    status = 'NEEDS_CLARIFICATION';
  }

  // ── Recommended action ─────────────────────────────────────────────────────

  const RECOMMENDED_ACTIONS: Record<ReadinessStatus, string> = {
    READY: 'Proceed with implementation.',
    MOSTLY_READY:
      'Proceed with implementation. Use existing project conventions for any unclear details. Flag missing specifics before guessing.',
    NEEDS_CLARIFICATION:
      'Seek clarification on open questions before or during implementation. Do not invent missing business rules.',
    BLOCKED: 'Resolve blockers before starting implementation.',
  };

  return {
    status,
    score,
    reasons,
    blockers: blockerDescriptions,
    recommendedAction: RECOMMENDED_ACTIONS[status],
  };
}
