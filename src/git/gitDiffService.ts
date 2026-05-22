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

const DEFAULT_MAX_DIFF_CHARS =
  process.env['MCP_MAX_DIFF_CHARS'] !== undefined
    ? Number(process.env['MCP_MAX_DIFF_CHARS'])
    : 50_000;

// ── File classification helpers ────────────────────────────────────────────────

/** Exact lockfile basenames */
const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Pipfile.lock',
  'poetry.lock',
  'Gemfile.lock',
  'composer.lock',
]);

/**
 * Returns true if the file path is a lockfile that should be skipped for brevity.
 */
export function isLockfile(filePath: string): boolean {
  const base = filePath.split('/').pop() ?? filePath;
  if (LOCKFILE_NAMES.has(base)) return true;
  if (base.endsWith('.lock')) return true;
  return false;
}

/**
 * Returns true if the file is a generated or minified file that should be skipped.
 * Patterns: *.min.js, *.min.css, *-lock.json, dist/*, build/*
 */
export function isGeneratedFile(filePath: string): boolean {
  if (isLockfile(filePath)) return true;
  const base = filePath.split('/').pop() ?? filePath;
  if (base.endsWith('.min.js') || base.endsWith('.min.css')) return true;
  if (base.endsWith('-lock.json')) return true;
  // dist/* and build/* top-level directories
  if (filePath.startsWith('dist/') || filePath === 'dist') return true;
  if (filePath.startsWith('build/') || filePath === 'build') return true;
  return false;
}

// ── Diff text filtering ────────────────────────────────────────────────────────

/**
 * Processes raw unified diff text to:
 * - Skip body of binary files (keep the "Binary files ... differ" header)
 * - Replace body of generated/lockfiles with a placeholder comment
 * Returns the filtered diff text.
 */
export function filterDiffText(rawDiff: string): string {
  if (!rawDiff) return rawDiff;

  const lines = rawDiff.split('\n');
  const output: string[] = [];
  let i = 0;
  let currentFile: string | null = null;
  let skipCurrentFile = false;
  let skipReason: string | null = null;

  while (i < lines.length) {
    const line = lines[i];

    // Detect start of a new file diff (diff --git a/... b/...)
    if (line.startsWith('diff --git ')) {
      // Extract the file path from "diff --git a/<path> b/<path>"
      const match = /^diff --git a\/.+ b\/(.+)$/.exec(line);
      currentFile = match ? match[1] : null;
      skipCurrentFile = false;
      skipReason = null;

      if (currentFile !== null) {
        if (isLockfile(currentFile)) {
          skipCurrentFile = true;
          skipReason = '[lockfile — skipped for brevity]';
        } else if (isGeneratedFile(currentFile)) {
          skipCurrentFile = true;
          skipReason = '[generated/dependency file — skipped]';
        }
      }

      output.push(line);
      i++;
      continue;
    }

    // Detect binary file line
    if (line.startsWith('Binary files ') && line.includes(' differ')) {
      output.push(line); // keep the binary file notification, skip body (there is none)
      i++;
      continue;
    }

    // If we are in a file that should be skipped, consume hunk headers and diff lines
    if (skipCurrentFile && skipReason !== null) {
      // Emit index/--- /+++ lines (file metadata) but replace hunk bodies
      if (
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('rename from') ||
        line.startsWith('rename to')
      ) {
        output.push(line);
        i++;
        continue;
      }
      // Hunk header @@ ... @@ --- emit placeholder instead of hunk content
      if (line.startsWith('@@ ')) {
        output.push(skipReason);
        i++;
        // Skip the rest of the hunk body (until next @@, next diff --git, or EOF)
        while (i < lines.length) {
          const next = lines[i];
          if (next.startsWith('diff --git ') || next.startsWith('@@ ')) break;
          i++;
        }
        continue;
      }
      // Other lines inside the skipped file (no hunk started yet), skip them
      i++;
      continue;
    }

    output.push(line);
    i++;
  }

  return output.join('\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseFileStatus(statusCode: string): FileStatus {
  if (statusCode.startsWith('A')) return 'added';
  if (statusCode.startsWith('M')) return 'modified';
  if (statusCode.startsWith('D')) return 'deleted';
  if (statusCode.startsWith('R')) return 'renamed';
  return 'unknown';
}

/**
 * Parse a single line from `git diff --name-status` output.
 * Returns null if the line is empty or unparseable.
 */
export function parseNameStatusLine(line: string): ChangedFile | null {
  if (!line || line.trim().length === 0) return null;

  const parts = line.split('\t');
  if (parts.length < 2) return null;

  const statusCode = parts[0];
  const status = parseFileStatus(statusCode);

  if (status === 'renamed' && parts.length >= 3) {
    return {
      path: parts[2],
      status,
      oldPath: parts[1],
    };
  }

  return {
    path: parts[1] || '',
    status,
  };
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
  ], { maxBuffer: 10 * 1024 * 1024, timeout: 15_000 });

  // Apply binary/generated file filtering before measuring length
  const filtered = filterDiffText(stdout);
  const originalLength = filtered.length;
  const truncated = originalLength > maxDiffChars;
  const text = truncated ? filtered.slice(0, maxDiffChars) : filtered;

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
