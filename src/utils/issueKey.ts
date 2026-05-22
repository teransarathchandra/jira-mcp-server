import type { JiraProjectConfig } from '../config.js';

export const DEFAULT_ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

export function normalizeIssueKey(issueKey: string): string {
  return issueKey.trim().toUpperCase();
}

export function parseIssueKey(issueKey: string): { projectKey: string; issueNumber: string } {
  const normalized = normalizeIssueKey(issueKey);
  const dashIndex = normalized.indexOf('-');
  if (dashIndex === -1) {
    throw new Error('Invalid issue key format');
  }
  const projectKey = normalized.slice(0, dashIndex);
  const issueNumber = normalized.slice(dashIndex + 1);
  if (!projectKey || !issueNumber) {
    throw new Error('Invalid issue key format');
  }
  return { projectKey, issueNumber };
}

export function isValidIssueKey(issueKey: string, config?: JiraProjectConfig): boolean {
  const normalized = normalizeIssueKey(issueKey);
  const pattern = config?.issueKeyPattern ?? DEFAULT_ISSUE_KEY_PATTERN;
  return pattern.test(normalized);
}

export function validateIssueKeyOrThrow(issueKey: string, config?: JiraProjectConfig): string {
  const normalized = normalizeIssueKey(issueKey);
  if (!isValidIssueKey(normalized, config)) {
    throw new Error(
      `Invalid issue key: "${normalized}" does not match the expected pattern (e.g., ${config?.exampleIssueKey ?? 'PROJ-123'})`
    );
  }
  if (config?.strictProjectAllowlist && config.allowedProjectKeys.length > 0) {
    const { projectKey } = parseIssueKey(normalized);
    if (!config.allowedProjectKeys.includes(projectKey)) {
      throw new Error(
        `Project key "${projectKey}" is not in the allowed list: ${config.allowedProjectKeys.join(', ')}`
      );
    }
  }
  return normalized;
}

export function isAllowedProjectKey(projectKey: string, config: JiraProjectConfig): boolean {
  const normalized = projectKey.trim().toUpperCase();
  if (config.strictProjectAllowlist && config.allowedProjectKeys.length > 0) {
    return config.allowedProjectKeys.includes(normalized);
  }
  return true;
}

// Backward compat exports
export const ISSUE_KEY_REGEX = DEFAULT_ISSUE_KEY_PATTERN;

export function validateIssueKey(key: string): void {
  validateIssueKeyOrThrow(key);
}
