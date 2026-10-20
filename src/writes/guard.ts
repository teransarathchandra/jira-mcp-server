import type { Config } from '../config.js';
import { validateIssueKeyOrThrow } from '../utils/issueKey.js';

/**
 * Refuses a write before anything is previewed when the key is malformed or,
 * with JIRA_STRICT_PROJECT_ALLOWLIST on, the project is not allowed. The
 * allowlist rule is the one reads already use (validateIssueKeyOrThrow).
 * Returns the normalized key, which every later step must use.
 */
export function assertWritableIssue(issueKey: string, config: Config): string {
  return validateIssueKeyOrThrow(issueKey, config.projectConfig);
}
