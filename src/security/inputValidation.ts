import path from 'node:path';
import fs from 'node:fs';
import { ISSUE_KEY_REGEX } from '../utils/issueKey.js';
import { validateGitRef as gitSafetyValidateGitRef } from '../utils/gitSafety.js';

// ── McpInputError ──────────────────────────────────────────────────────────────

export class McpInputError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'McpInputError';
    this.field = field;
  }
}

// ── Issue Key ──────────────────────────────────────────────────────────────────

/**
 * Validates and returns the cleaned issue key.
 * Throws McpInputError if the value does not match CMPI-XXXX pattern.
 */
export function validateIssueKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new McpInputError('Issue key must be a string', 'issueKey');
  }
  const trimmed = value.trim();
  if (!ISSUE_KEY_REGEX.test(trimmed)) {
    throw new McpInputError(
      `Invalid issue key: must match CMPI-XXXX format (e.g., CMPI-1234)`,
      'issueKey'
    );
  }
  return trimmed;
}

// ── Page ID ────────────────────────────────────────────────────────────────────

/**
 * Validates a Confluence page ID (numeric string or number).
 * Throws McpInputError on failure.
 */
export function validatePageId(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw new McpInputError('Page ID must be a positive integer', 'pageId');
    }
    return String(value);
  }
  if (typeof value !== 'string') {
    throw new McpInputError('Page ID must be a numeric string or number', 'pageId');
  }
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new McpInputError('Page ID must be a positive numeric string', 'pageId');
  }
  return trimmed;
}

// ── PR Number ─────────────────────────────────────────────────────────────────

/**
 * Validates a PR number (positive integer).
 * Throws McpInputError on failure.
 */
export function validatePrNumber(value: unknown): number {
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) {
      throw new McpInputError('PR number must be a positive integer', 'prNumber');
    }
  }
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isInteger(num) || num <= 0) {
    throw new McpInputError('PR number must be a positive integer', 'prNumber');
  }
  return num;
}

// ── Git Ref ───────────────────────────────────────────────────────────────────

/**
 * Validates a git ref (branch/commit/tag).
 * Wraps gitSafety.validateGitRef and throws McpInputError on failure.
 */
export function validateGitRef(value: unknown): string {
  if (typeof value !== 'string') {
    throw new McpInputError('Git ref must be a string', 'gitRef');
  }
  try {
    gitSafetyValidateGitRef(value);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpInputError(msg, 'gitRef');
  }
  return value;
}

// ── Repo Path ─────────────────────────────────────────────────────────────────

/**
 * Validates and resolves a repository path.
 * Throws McpInputError if the path is unsafe or does not exist as a directory.
 * If allowedRoots is provided, the resolved path must start with one of them.
 */
export function validateRepoPath(value: unknown, allowedRoots?: string[]): string {
  if (typeof value !== 'string') {
    throw new McpInputError('Repository path must be a string', 'repoPath');
  }
  if (value.includes('\x00')) {
    throw new McpInputError('Repository path must not contain null bytes', 'repoPath');
  }
  if (value.trim() === '') {
    throw new McpInputError('Repository path must not be empty', 'repoPath');
  }

  const resolved = path.resolve(value);

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new McpInputError('Repository path must point to a directory', 'repoPath');
    }
  } catch (err) {
    if (err instanceof McpInputError) throw err;
    throw new McpInputError('Repository path does not exist or is not accessible', 'repoPath');
  }

  if (allowedRoots && allowedRoots.length > 0) {
    const withinAllowed = allowedRoots.some((root) => {
      const resolvedRoot = path.resolve(root);
      return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
    });
    if (!withinAllowed) {
      throw new McpInputError(
        'Repository path is outside the allowed directories',
        'repoPath'
      );
    }
  }

  return resolved;
}

// ── Output Path ───────────────────────────────────────────────────────────────

/**
 * Validates an output file path.
 * Rejects path traversal (..) and absolute paths (unless allowAbsolute=true).
 */
export function validateOutputPath(value: unknown, allowAbsolute = false): string {
  if (typeof value !== 'string') {
    throw new McpInputError('Output path must be a string', 'outputPath');
  }
  if (value.trim() === '') {
    throw new McpInputError('Output path must not be empty', 'outputPath');
  }

  // Reject path traversal components
  const parts = value.split(/[/\\]/);
  if (parts.some((part) => part === '..')) {
    throw new McpInputError(
      'Output path must not contain path traversal components (..)',
      'outputPath'
    );
  }

  if (!allowAbsolute && path.isAbsolute(value)) {
    throw new McpInputError(
      'Output path must not be an absolute path',
      'outputPath'
    );
  }

  return value;
}

// ── Space Keys ────────────────────────────────────────────────────────────────

const SPACE_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

/**
 * Validates an array of Confluence space keys.
 * Each key must be 1-50 chars, alphanumeric + hyphen + underscore only.
 */
export function validateSpaceKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new McpInputError('Space keys must be an array', 'spaceKeys');
  }
  for (const key of value) {
    if (typeof key !== 'string') {
      throw new McpInputError('Each space key must be a string', 'spaceKeys');
    }
    if (!SPACE_KEY_PATTERN.test(key)) {
      throw new McpInputError(
        `Invalid space key "${key}": must be 1-50 characters, alphanumeric, hyphen, or underscore only`,
        'spaceKeys'
      );
    }
  }
  return value as string[];
}

// ── Integer Range ─────────────────────────────────────────────────────────────

/**
 * Clamps an integer to [min, max], throwing McpInputError if value is not a valid integer.
 */
export function validateIntInRange(
  value: unknown,
  name: string,
  min: number,
  max: number
): number {
  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value)) {
      throw new McpInputError(`${name} must be an integer`, name);
    }
  }
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isInteger(num) || !isFinite(num)) {
    throw new McpInputError(`${name} must be an integer`, name);
  }
  if (num < min || num > max) {
    throw new McpInputError(`${name} must be between ${min} and ${max}`, name);
  }
  return num;
}

// ── Boolean ───────────────────────────────────────────────────────────────────

/**
 * Validates a boolean-ish value (true/false/'true'/'false'/1/0).
 */
export function validateBoolean(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1) return true;
  if (value === 0) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new McpInputError(
    `${name} must be a boolean or boolean-like value (true/false/'true'/'false'/1/0)`,
    name
  );
}
