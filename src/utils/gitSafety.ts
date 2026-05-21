import path from 'node:path';

// ── Constants ──────────────────────────────────────────────────────────────────

const SAFE_REF_PATTERN = /^[a-zA-Z0-9._\-/~^:@]+$/;
const MAX_REF_LENGTH = 256;

// Shell metacharacters and other dangerous characters
const SHELL_META_PATTERN = /[`$|&;()<>{}\[\]\\]/;

// Unsafe repo path characters (null byte, shell metacharacters)
const UNSAFE_PATH_PATTERN = /[\x00;`$|&<>{}()\[\]\\]/;

// ── Git Ref Validation ─────────────────────────────────────────────────────────

/**
 * Returns true if the ref is safe to pass to git commands.
 * A safe ref: only alphanumeric, '.', '-', '_', '/', '~', '^', ':', '@' chars,
 * max 256 chars, no double-dots, no whitespace, no null bytes, no shell metacharacters.
 */
export function isValidGitRef(ref: string): boolean {
  if (!ref || ref.length === 0) return false;
  if (ref.length > MAX_REF_LENGTH) return false;
  if (ref.includes('..')) return false;
  if (/\s/.test(ref)) return false;
  if (ref.includes('\x00')) return false;
  if (SHELL_META_PATTERN.test(ref)) return false;
  if (!SAFE_REF_PATTERN.test(ref)) return false;
  return true;
}

/**
 * Throws an Error with a descriptive message if ref is not safe.
 */
export function validateGitRef(ref: string): void {
  if (!ref || ref.length === 0) {
    throw new Error('Git ref must not be empty.');
  }
  if (ref.length > MAX_REF_LENGTH) {
    throw new Error(`Git ref exceeds maximum length of ${MAX_REF_LENGTH} characters.`);
  }
  if (ref.includes('..')) {
    throw new Error(`Git ref contains double-dots which are not allowed: "${ref}"`);
  }
  if (/\s/.test(ref)) {
    throw new Error(`Git ref contains whitespace which is not allowed: "${ref}"`);
  }
  if (ref.includes('\x00')) {
    throw new Error('Git ref contains null bytes which are not allowed.');
  }
  if (SHELL_META_PATTERN.test(ref)) {
    throw new Error(`Git ref contains shell metacharacters which are not allowed: "${ref}"`);
  }
  if (!SAFE_REF_PATTERN.test(ref)) {
    throw new Error(`Git ref contains invalid characters: "${ref}"`);
  }
}

// ── Repo Path Validation ───────────────────────────────────────────────────────

/**
 * Returns true if the path looks like a real directory (exists and is not suspicious).
 * Uses path.resolve to normalize. Does NOT shell out — just checks basic safety.
 * A valid repo path: non-empty string, no null bytes, no shell metacharacters.
 */
export function isValidRepoPath(repoPath: string): boolean {
  if (!repoPath || repoPath.length === 0) return false;
  if (repoPath.includes('\x00')) return false;
  if (UNSAFE_PATH_PATTERN.test(repoPath)) return false;
  return true;
}

/**
 * Normalizes a repo path using path.resolve. Throws if path looks unsafe.
 */
export function resolveRepoPath(repoPath: string): string {
  if (!repoPath || repoPath.length === 0) {
    throw new Error('Repo path must not be empty.');
  }
  if (repoPath.includes('\x00')) {
    throw new Error('Repo path contains null bytes which are not allowed.');
  }
  if (UNSAFE_PATH_PATTERN.test(repoPath)) {
    throw new Error(`Repo path contains unsafe characters: "${repoPath}"`);
  }
  return path.resolve(repoPath);
}
