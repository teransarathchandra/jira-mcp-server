import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { validateGitRef, resolveRepoPath } from '../utils/gitSafety.js';

const execFile = promisify(execFileCb);

// ── Types ──────────────────────────────────────────────────────────────────────

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';

export interface ChangedFile {
  path: string;
  status: FileStatus;
  oldPath?: string; // for renames
}

export interface DiffResult {
  changedFiles: ChangedFile[];
  diffText: string;
  diffStats: string;
  truncated: boolean;
  originalDiffLength: number;
  warnings: string[];
  currentBranch: string;
  baseBranch: string;
  compareRef: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_DIFF_CHARS = 50_000;

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseFileStatus(statusCode: string): FileStatus {
  if (statusCode.startsWith('A')) return 'added';
  if (statusCode.startsWith('M')) return 'modified';
  if (statusCode.startsWith('D')) return 'deleted';
  if (statusCode.startsWith('R')) return 'renamed';
  return 'unknown';
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Check if repoPath is a git repository by running: git -C <repoPath> rev-parse --git-dir
 * Returns true if exit code 0, false otherwise.
 */
export async function isGitRepository(repoPath: string): Promise<boolean> {
  const resolved = resolveRepoPath(repoPath);
  try {
    await execFile('git', ['-C', resolved, 'rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current branch name. Runs: git -C <repoPath> rev-parse --abbrev-ref HEAD
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  const resolved = resolveRepoPath(repoPath);
  const { stdout } = await execFile('git', ['-C', resolved, 'rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
}

/**
 * Get changed files between baseBranch and compareRef.
 * Runs: git -C <repoPath> diff --name-status <baseBranch>...<compareRef>
 * Validates both baseBranch and compareRef using validateGitRef before use.
 */
export async function getChangedFiles(
  repoPath: string,
  baseBranch: string,
  compareRef: string
): Promise<ChangedFile[]> {
  validateGitRef(baseBranch);
  validateGitRef(compareRef);
  const resolved = resolveRepoPath(repoPath);

  const { stdout } = await execFile('git', [
    '-C', resolved,
    'diff',
    '--name-status',
    `${baseBranch}...${compareRef}`,
  ]);

  const changedFiles: ChangedFile[] = [];
  const lines = stdout.trim().split('\n').filter(line => line.length > 0);

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;

    const statusCode = parts[0];
    const status = parseFileStatus(statusCode);

    if (status === 'renamed' && parts.length >= 3) {
      changedFiles.push({
        path: parts[2],
        status,
        oldPath: parts[1],
      });
    } else {
      changedFiles.push({
        path: parts[1],
        status,
      });
    }
  }

  return changedFiles;
}

/**
 * Get the diff text between baseBranch and compareRef.
 * Runs: git -C <repoPath> diff <baseBranch>...<compareRef>
 * Truncates to maxDiffChars if needed. Default maxDiffChars = 50000.
 * Validates both refs before use.
 */
export async function getDiff(
  repoPath: string,
  baseBranch: string,
  compareRef: string,
  maxDiffChars: number = DEFAULT_MAX_DIFF_CHARS
): Promise<{ text: string; truncated: boolean; originalLength: number }> {
  validateGitRef(baseBranch);
  validateGitRef(compareRef);
  const resolved = resolveRepoPath(repoPath);

  const { stdout } = await execFile('git', [
    '-C', resolved,
    'diff',
    `${baseBranch}...${compareRef}`,
  ]);

  const originalLength = stdout.length;
  const truncated = originalLength > maxDiffChars;
  const text = truncated ? stdout.slice(0, maxDiffChars) : stdout;

  return { text, truncated, originalLength };
}

/**
 * Get diff stats (summary line counts).
 * Runs: git -C <repoPath> diff --stat <baseBranch>...<compareRef>
 */
export async function getDiffStats(
  repoPath: string,
  baseBranch: string,
  compareRef: string
): Promise<string> {
  validateGitRef(baseBranch);
  validateGitRef(compareRef);
  const resolved = resolveRepoPath(repoPath);

  const { stdout } = await execFile('git', [
    '-C', resolved,
    'diff',
    '--stat',
    `${baseBranch}...${compareRef}`,
  ]);

  return stdout.trim();
}

/**
 * High-level function that combines all of the above.
 * Validates repoPath, validates refs, checks isGitRepository, then calls the above.
 * Returns a DiffResult.
 */
export async function getDiffResult(
  repoPath: string,
  baseBranch: string,
  compareRef: string,
  maxDiffChars: number = DEFAULT_MAX_DIFF_CHARS
): Promise<DiffResult> {
  // Validate refs eagerly before any I/O
  validateGitRef(baseBranch);
  validateGitRef(compareRef);
  const resolved = resolveRepoPath(repoPath);

  const warnings: string[] = [];

  const isRepo = await isGitRepository(resolved);
  if (!isRepo) {
    throw new Error(`Path is not a git repository: "${resolved}"`);
  }

  const [currentBranch, changedFiles, diffData, diffStats] = await Promise.all([
    getCurrentBranch(resolved),
    getChangedFiles(resolved, baseBranch, compareRef),
    getDiff(resolved, baseBranch, compareRef, maxDiffChars),
    getDiffStats(resolved, baseBranch, compareRef),
  ]);

  if (diffData.truncated) {
    warnings.push(
      `Diff was truncated from ${diffData.originalLength} to ${maxDiffChars} characters.`
    );
  }

  return {
    changedFiles,
    diffText: diffData.text,
    diffStats,
    truncated: diffData.truncated,
    originalDiffLength: diffData.originalLength,
    warnings,
    currentBranch,
    baseBranch,
    compareRef,
  };
}
