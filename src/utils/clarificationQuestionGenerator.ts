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

/**
 * Returns true if the given text is already answered by any of the provided
 * acceptance criteria or business rules (rough substring overlap check).
 */
function isAlreadyAnswered(topic: string, acceptanceCriteria: string[], businessRules: string[]): boolean {
  const topicLower = topic.toLowerCase();
  const sources = [...acceptanceCriteria, ...businessRules];
  for (const src of sources) {
    // If at least 5 consecutive words of the topic appear in a source, consider it answered
    const words = topicLower.split(/\s+/).filter(w => w.length > 3);
    if (words.length === 0) continue;
    const matchCount = words.filter(w => src.toLowerCase().includes(w)).length;
    if (matchCount >= Math.min(3, words.length)) return true;
  }
  return false;
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
    mainDescription,
    acceptanceCriteria,
    userRoles,
    validationRules,
    businessRules,
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

  // 4. Missing validation details
  if (questions.length < 5) {
    const validationWithKeyword = validationRules.find(r =>
      /validate|required|invalid/i.test(r),
    );
    if (validationWithKeyword) {
      const topic = 'validation error message';
      if (
        !seenTopics.has(topic) &&
        !isAlreadyAnswered(topic, acceptanceCriteria, businessRules)
      ) {
        addQuestion({
          question: `What exact error message should appear when ${truncate(validationWithKeyword, 80)}?`,
          priority: 'medium',
          topic,
        });
      }
    }
  }

  // 5. Missing user role scope
  if (questions.length < 5) {
    const descLower = mainDescription.toLowerCase();
    const isUserFacing =
      /\b(user|display|show|form|page|screen|button|modal|ui|click|view|render)\b/i.test(descLower);
    if (userRoles.length === 0 && isUserFacing) {
      const topic = 'user roles';
      if (!seenTopics.has(topic)) {
        addQuestion({
          question: 'Which user roles should be affected by this change?',
          priority: 'medium',
          topic,
        });
      }
    }
  }

  // 6. Mobile/responsive question
  if (questions.length < 5) {
    const descLower = mainDescription.toLowerCase();
    const mentionsUI = /\b(ui|form|page|screen|button|modal|layout|display|render|view)\b/i.test(descLower);
    const mentionsMobile = /\b(mobile|responsive|tablet|breakpoint|viewport)\b/i.test(descLower);
    if (mentionsUI && !mentionsMobile) {
      const topic = 'mobile support';
      if (!seenTopics.has(topic)) {
        addQuestion({
          question: 'Should this UI change apply to both desktop and mobile views?',
          priority: 'medium',
          topic,
        });
      }
    }
  }

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
