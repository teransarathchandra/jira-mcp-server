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
