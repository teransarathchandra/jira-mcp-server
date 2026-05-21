export interface JiraCommentInput {
  id: string;
  author: string;
  body: string;       // already converted to plain text/markdown
  created: string;    // ISO date string
  updated: string;
}

export interface CommentSignal {
  type: 'acceptance_criteria' | 'bug' | 'edge_case' | 'validation' | 'business_rule' |
        'api_behavior' | 'ui_behavior' | 'blocker' | 'clarification' | 'implementation_hint' |
        'test_expectation' | 'requirement_change';
  excerpt: string;    // short relevant excerpt (max 200 chars)
}

// Exact short-phrase noise list (lower-cased for comparison)
const NOISE_EXACT_PHRASES = new Set([
  'done',
  'fixed',
  'please check',
  'ok',
  'noted',
  'thanks',
  'thank you',
  'approved',
  'lgtm',
  'will do',
  'checked',
  'verified',
  'done and dusted',
  'resolved',
]);

// Automated system comment substrings (lower-cased)
const AUTOMATED_PATTERNS = [
  'automatically transitioned',
  'workflow triggered',
  'issue moved',
  'status changed to',
  'build #',
  'jenkins',
  'automated',
];

/**
 * Returns true if the comment is likely to contain useful requirements/clarifications.
 */
export function isUsefulComment(commentText: string): boolean {
  const trimmed = commentText.trim();

  // Too short
  if (trimmed.length < 15) {
    return false;
  }

  const lower = trimmed.toLowerCase();

  // Exact noise phrases
  if (NOISE_EXACT_PHRASES.has(lower)) {
    return false;
  }

  // Automated system comments
  for (const pattern of AUTOMATED_PATTERNS) {
    if (lower.includes(pattern)) {
      return false;
    }
  }

  // Pure mention: text is just "@username" (one token starting with @, no spaces)
  if (/^@\S+$/.test(trimmed)) {
    return false;
  }

  // Signal patterns — if any match, it's useful
  if (
    lower.includes('acceptance criteria') ||
    lower.includes('ac:') ||
    lower.includes('definition of done') ||
    lower.includes('should') ||
    lower.includes('must') ||
    lower.includes('shall') ||
    lower.includes('error') ||
    lower.includes('bug') ||
    lower.includes('issue') ||
    lower.includes('problem') ||
    lower.includes('fail') ||
    lower.includes('edge case') ||
    lower.includes('corner case') ||
    lower.includes('validate') ||
    lower.includes('validation') ||
    lower.includes('required field') ||
    lower.includes('business rule') ||
    lower.includes('business logic') ||
    lower.includes('api') ||
    lower.includes('endpoint') ||
    lower.includes('rest') ||
    lower.includes('http') ||
    lower.includes('ui') ||
    lower.includes('button') ||
    lower.includes('form') ||
    lower.includes('modal') ||
    lower.includes('screen') ||
    lower.includes('page') ||
    lower.includes('block') ||
    lower.includes('blocked') ||
    lower.includes('blocker') ||
    lower.includes('cannot proceed') ||
    lower.includes('clarif') ||
    lower.includes('unclear') ||
    lower.includes('ambiguous') ||
    lower.includes('confirm') ||
    lower.includes('implement') ||
    lower.includes('how to') ||
    lower.includes('approach') ||
    lower.includes('suggest') ||
    lower.includes('test') ||
    lower.includes('unit test') ||
    lower.includes('spec') ||
    lower.includes('given/when/then') ||
    lower.includes('change') ||
    lower.includes('update the requirement') ||
    lower.includes('instead') ||
    lower.includes('actually') ||
    lower.includes('permission') ||
    lower.includes('role') ||
    lower.includes('admin') ||
    lower.includes('user access') ||
    lower.includes('deadline') ||
    lower.includes('urgent') ||
    lower.includes('priority') ||
    trimmed.length > 100
  ) {
    return true;
  }

  return false;
}

interface PatternRule {
  patterns: string[];
  type: CommentSignal['type'];
}

const SIGNAL_RULES: PatternRule[] = [
  {
    patterns: ['acceptance criteria', 'ac:', 'definition of done'],
    type: 'acceptance_criteria',
  },
  {
    patterns: ['error', 'bug', 'fail', 'broken'],
    type: 'bug',
  },
  {
    patterns: ['edge case', 'corner case'],
    type: 'edge_case',
  },
  {
    patterns: ['validate', 'validation', 'required field'],
    type: 'validation',
  },
  {
    patterns: ['business rule', 'business logic'],
    type: 'business_rule',
  },
  {
    patterns: ['api', 'endpoint', 'rest', 'http'],
    type: 'api_behavior',
  },
  {
    patterns: ['ui', 'button', 'form', 'modal', 'screen', 'page'],
    type: 'ui_behavior',
  },
  {
    patterns: ['block', 'blocked', 'blocker', 'cannot proceed'],
    type: 'blocker',
  },
  {
    patterns: ['clarif', 'unclear', 'ambiguous', 'confirm'],
    type: 'clarification',
  },
  {
    patterns: ['implement', 'how to', 'approach', 'suggest'],
    type: 'implementation_hint',
  },
  {
    patterns: ['test', 'unit test', 'spec'],
    type: 'test_expectation',
  },
  {
    patterns: ['change', 'update the requirement', 'instead', 'actually'],
    type: 'requirement_change',
  },
];

/**
 * Extracts the sentence containing the matched keyword, or the first 200 chars of the comment.
 */
function extractExcerpt(commentText: string, matchedPattern: string): string {
  const lower = commentText.toLowerCase();
  const idx = lower.indexOf(matchedPattern.toLowerCase());

  if (idx === -1) {
    return commentText.slice(0, 200).trim();
  }

  // Find the sentence boundaries around the match
  const sentenceStart = Math.max(
    commentText.lastIndexOf('.', idx),
    commentText.lastIndexOf('\n', idx),
    commentText.lastIndexOf('!', idx),
    commentText.lastIndexOf('?', idx),
  );
  const start = sentenceStart === -1 ? 0 : sentenceStart + 1;

  const afterMatch = idx + matchedPattern.length;
  const sentenceEnd = Math.min(
    ...[
      commentText.indexOf('.', afterMatch),
      commentText.indexOf('\n', afterMatch),
      commentText.indexOf('!', afterMatch),
      commentText.indexOf('?', afterMatch),
    ].filter(n => n !== -1).concat(commentText.length > 0 ? [commentText.length] : []),
  );
  const end = sentenceEnd === commentText.length ? commentText.length : sentenceEnd + 1;

  const sentence = commentText.slice(start, end).trim();
  return sentence.slice(0, 200).trim();
}

/**
 * Returns an array of signals found in the comment.
 */
export function extractRequirementSignals(commentText: string): CommentSignal[] {
  const lower = commentText.toLowerCase();
  const signals: CommentSignal[] = [];
  const seenTypes = new Set<CommentSignal['type']>();

  for (const rule of SIGNAL_RULES) {
    if (seenTypes.has(rule.type)) {
      continue;
    }

    for (const pattern of rule.patterns) {
      if (lower.includes(pattern.toLowerCase())) {
        const excerpt = extractExcerpt(commentText, pattern);
        signals.push({ type: rule.type, excerpt });
        seenTypes.add(rule.type);
        break; // only one signal per type
      }
    }
  }

  return signals;
}

/**
 * Filters to useful comments, sorts by created date (most recent first),
 * and formats up to 10 most useful comments.
 */
export function summarizeUsefulComments(comments: JiraCommentInput[]): string {
  const useful = comments.filter(c => isUsefulComment(c.body));

  if (useful.length === 0) {
    return 'No requirement-related comments found.';
  }

  // Sort by created date, most recent first
  useful.sort((a, b) => {
    const dateA = new Date(a.created).getTime();
    const dateB = new Date(b.created).getTime();
    return dateB - dateA;
  });

  const top10 = useful.slice(0, 10);

  const lines: string[] = [];
  for (const comment of top10) {
    const date = new Date(comment.created).toISOString().slice(0, 10); // YYYY-MM-DD
    const bodyPreview = comment.body.trim().slice(0, 300);
    const signals = extractRequirementSignals(comment.body);
    const signalTypes = signals.map(s => s.type).join(', ');

    let entry = `- **[${date}] ${comment.author}**: ${bodyPreview}`;
    if (signalTypes) {
      entry += `\n  Signals: ${signalTypes}`;
    }
    lines.push(entry);
  }

  return lines.join('\n');
}
