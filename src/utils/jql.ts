// Jira project keys: one or more uppercase letters/digits starting with a letter.
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]*$/;

// Jira issue keys: PROJECT_KEY-DIGITS
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/;

/**
 * Escape a string value for use inside a JQL quoted string.
 * Backslashes must be escaped first, then double-quotes.
 */
export function escapeJqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Wrap a value in double-quotes for JQL, escaping internal characters.
 */
export function quoteJqlString(value: string): string {
  return `"${escapeJqlString(value)}"`;
}

/**
 * Validate and return a JQL-safe project key.
 * Throws if the key does not match the expected format.
 */
export function safeJqlProjectKey(key: string): string {
  const trimmed = key.trim().toUpperCase();
  if (!PROJECT_KEY_RE.test(trimmed)) {
    throw new Error(`Invalid Jira project key: "${key}"`);
  }
  return trimmed;
}

/**
 * Validate and return a JQL-safe issue key.
 * Throws if the key does not match the expected format.
 */
export function safeJqlIssueKey(key: string): string {
  const trimmed = key.trim().toUpperCase();
  if (!ISSUE_KEY_RE.test(trimmed)) {
    throw new Error(`Invalid Jira issue key: "${key}"`);
  }
  return trimmed;
}

/**
 * Build: project = "KEY"
 */
export function buildProjectJql(projectKey: string): string {
  return `project = "${safeJqlProjectKey(projectKey)}"`;
}

/**
 * Build: project in ("KEY1", "KEY2", ...)
 */
export function buildProjectInJql(projectKeys: string[]): string {
  const quoted = projectKeys.map(k => `"${safeJqlProjectKey(k)}"`).join(', ');
  return `project in (${quoted})`;
}

const MAX_FILTER_LENGTH = 1000;

/**
 * Index of each character outside a quoted JQL string ("…" or '…', with
 * backslash escapes), or an error for an unterminated quote.
 */
function unquotedIndexes(text: string): number[] {
  const indexes: number[] = [];
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else {
      indexes.push(i);
    }
  }
  if (quote) throw new Error('JQL filter has an unterminated quote.');
  return indexes;
}

/**
 * Combine a caller-supplied JQL filter with an optional scope clause:
 * `scope AND (filter) ORDER BY …`. The filter's parentheses must balance
 * outside quoted values, so it cannot close the wrapping parentheses and
 * reach outside the scope (e.g. `x) OR (project = OTHER`).
 */
export function scopeJql(filter: string, scope?: string): string {
  const text = filter.replace(/\s+/g, ' ').trim();
  if (text.length === 0) throw new Error('JQL filter is empty.');
  if (text.length > MAX_FILTER_LENGTH) throw new Error(`JQL filter is longer than ${MAX_FILTER_LENGTH} characters.`);

  const unquoted = unquotedIndexes(text);
  const visible = new Set(unquoted);
  let condition = text;
  let orderBy = '';
  for (const match of text.matchAll(/\bORDER\s+BY\b/gi)) {
    if (visible.has(match.index ?? -1)) {
      condition = text.slice(0, match.index).trim();
      orderBy = text.slice((match.index ?? 0) + match[0].length).trim();
    }
  }

  let depth = 0;
  for (const i of unquoted) {
    if (i >= condition.length) break;
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth < 0) break;
  }
  if (depth !== 0) throw new Error('JQL filter has unbalanced parentheses.');

  const where = [scope, condition ? `(${condition})` : ''].filter(Boolean).join(' AND ');
  return [where, orderBy ? `ORDER BY ${orderBy}` : ''].filter(Boolean).join(' ');
}
