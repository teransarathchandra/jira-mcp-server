import { ReadinessStatus } from './readinessEvaluator.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClarificationQuestion {
  question: string;
  priority: 'blocker' | 'high' | 'medium';
  topic: string;
}

export interface ClarificationResult {
  questions: ClarificationQuestion[];
  shouldAsk: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen);
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Generates specific, practical clarification questions when a ticket is not ready.
 * At most 5 questions are returned.
 */
export function generateClarificationQuestions(params: {
  readinessStatus: ReadinessStatus;
  ambiguities: string[];
  conflictDescriptions: string[];
  hasBlockingIssues: boolean;
  blockerDescriptions: string[];
  mainDescription: string;
  acceptanceCriteria: string[];
  technicalSignals: string[];
  userRoles: string[];
  validationRules: string[];
  businessRules: string[];
  latestCommentIntroducesQuestion: boolean;
  latestCommentBody: string;
}): ClarificationResult {
  const {
    readinessStatus,
    ambiguities,
    conflictDescriptions,
    hasBlockingIssues,
    blockerDescriptions,
  } = params;

  const shouldAsk =
    readinessStatus === 'NEEDS_CLARIFICATION' || readinessStatus === 'BLOCKED';

  if (!shouldAsk) {
    return { questions: [], shouldAsk: false };
  }

  const questions: ClarificationQuestion[] = [];
  const seenTopics = new Set<string>();

  function addQuestion(q: ClarificationQuestion): boolean {
    if (questions.length >= 5) return false;
    if (seenTopics.has(q.topic)) return false;
    seenTopics.add(q.topic);
    questions.push(q);
    return true;
  }

  // 1. Blocker questions
  if (hasBlockingIssues) {
    for (const blocker of blockerDescriptions) {
      const added = addQuestion({
        question: `Resolve blocker: ${truncate(blocker, 80)}`,
        priority: 'blocker',
        topic: 'blocker',
      });
      if (!added) break;
    }
  }

  // 2. Conflict resolution questions
  for (const conflict of conflictDescriptions) {
    if (questions.length >= 5) break;
    const lower = conflict.toLowerCase();

    let question: string;
    let topic: string;

    if (lower.includes('warning') && (lower.includes('block') || lower.includes('submit'))) {
      question = 'Should the validation failure block submission or show only a warning to the user?';
      topic = 'validation behavior';
    } else if (lower.includes('admin') && (lower.includes('all users') || lower.includes('everyone'))) {
      question = 'Should this feature be restricted to administrators or available to all users?';
      topic = 'user roles';
    } else {
      question = `Clarify conflicting requirement: ${truncate(conflict, 80)}`;
      topic = `conflict: ${truncate(conflict, 40)}`;
    }

    if (!seenTopics.has(topic)) {
      addQuestion({ question, priority: 'high', topic });
    }
  }

  // 3. Ambiguity questions (not already covered by conflicts)
  for (const ambiguity of ambiguities) {
    if (questions.length >= 5) break;
    const topic = `ambiguity: ${truncate(ambiguity, 40)}`;
    if (!seenTopics.has(topic)) {
      addQuestion({
        question: `Resolve: ${truncate(ambiguity, 80)}`,
        priority: 'high',
        topic,
      });
    }
  }

  // Questions inferred only from silence (validation copy, user roles, mobile
  // support) were removed in R2: they are speculative, not material.

  return { questions, shouldAsk };
}

// ── Format helper ─────────────────────────────────────────────────────────────

/**
 * Formats the clarification questions into a readable markdown section.
 * Returns an empty string if shouldAsk is false.
 */
export function formatClarificationSection(result: ClarificationResult): string {
  if (!result.shouldAsk || result.questions.length === 0) {
    return '';
  }

  const lines: string[] = [
    '## Clarification Needed',
    '',
    'Before implementing, consider getting answers to:',
  ];

  for (const q of result.questions) {
    lines.push(`- [${q.priority}] ${q.question}`);
  }

  return lines.join('\n');
}
