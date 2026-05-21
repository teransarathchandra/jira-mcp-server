import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { validateGitRef, resolveRepoPath } from '../utils/gitSafety.js';
import { fetchIssueContext, ContextFetchOptions } from '../jira/issueContextService.js';
import { extractRequirements } from '../utils/requirementExtractor.js';
import { isGitRepository, getDiffResult } from '../git/gitDiffService.js';
import { classifyChangedFiles } from '../utils/changedFileClassifier.js';
import type { ChangedFile } from '../git/gitDiffService.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PreparePrReviewPromptInput {
  issueKey: string;
  baseBranch: string;
  compareRef: string;
  repoPath: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fileStatusLetter(status: ChangedFile['status']): string {
  switch (status) {
    case 'added':    return 'A';
    case 'modified': return 'M';
    case 'deleted':  return 'D';
    case 'renamed':  return 'R';
    default:         return '?';
  }
}

// ── Main function ──────────────────────────────────────────────────────────────

export async function preparePrReviewPrompt(
  input: PreparePrReviewPromptInput,
  client: JiraClient,
  config: Config,
): Promise<string> {
  // ── Step 1: Validate inputs ────────────────────────────────────────────────
  validateIssueKey(input.issueKey);
  validateGitRef(input.baseBranch);
  validateGitRef(input.compareRef);

  // ── Step 2: Fetch Jira context ─────────────────────────────────────────────
  const options: ContextFetchOptions = {
    includeComments: true,
    includeParent: true,
    includeEpic: true,
    includeLinkedIssues: true,
    includeSubtasks: false,
    includeEpicSiblings: false,
    maxLinkedIssues: 8,
    maxSubtasks: 10,
    maxCommentsPerIssue: 10,
    contextDepth: 1,
  };

  const context = await fetchIssueContext(input.issueKey, options, client, config);
  const { key, fields } = context.mainIssue;
  const mainIssueDescription = context.mainIssueDescription;
  const issueSummary = fields.summary;
  const issueStatus = fields.status.name;

  // ── Step 3: Extract requirement signals ───────────────────────────────────
  const requirementSignals = extractRequirements(mainIssueDescription);

  // ── Step 4: Get changed files (limited diff for prompt context) ────────────
  const resolvedPath = resolveRepoPath(input.repoPath);

  const isRepo = await isGitRepository(resolvedPath);
  if (!isRepo) {
    return `Not a git repository: ${input.repoPath}. Please provide a valid repository path.`;
  }

  let diffResult;
  try {
    diffResult = await getDiffResult(
      resolvedPath,
      input.baseBranch,
      input.compareRef,
      5000,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      `Could not get diff: ${message}. ` +
      `Check that baseBranch '${input.baseBranch}' and compareRef '${input.compareRef}' exist in the repository.`
    );
  }

  // ── Step 5: Classify changed files ────────────────────────────────────────
  const classifiedFiles = classifyChangedFiles(diffResult.changedFiles);
  const allFiles = diffResult.changedFiles;

  // Build quick match for missing signals
  const diffLower = diffResult.diffText.toLowerCase();
  const allPathsCombined = allFiles.map(f => f.path).join(' ').toLowerCase();
  const missingSignals = requirementSignals.technicalSignals.filter(signal => {
    const lower = signal.toLowerCase();
    return !allPathsCombined.includes(lower) && !diffLower.includes(lower);
  });

  // ── Step 6: Format and return the review prompt ────────────────────────────

  // Changed files list (up to 30)
  const changedFileLines = allFiles.slice(0, 30).map(f => {
    const letter = fileStatusLetter(f.status);
    return `  ${letter} ${f.path}`;
  });
  if (allFiles.length > 30) {
    changedFileLines.push(`  ... and ${allFiles.length - 30} more`);
  }

  // AC list
  const acLines = requirementSignals.acceptanceCriteria.length > 0
    ? requirementSignals.acceptanceCriteria.map(ac => `  - ${ac}`)
    : ['  No explicit acceptance criteria found.'];

  // Source files for inspection (up to 15 most relevant non-test, non-config)
  const sourceFilesForInspection = [
    ...classifiedFiles.sourceFiles,
    ...classifiedFiles.backendFiles,
    ...classifiedFiles.frontendFiles,
  ]
    .filter((f, idx, arr) => arr.findIndex(x => x.path === f.path) === idx) // dedup
    .slice(0, 15)
    .map(f => `  - ${f.path}`);

  if (sourceFilesForInspection.length === 0) {
    // Fallback: list first 15 non-test files
    const fallback = allFiles
      .filter(f => !classifiedFiles.testFiles.some(t => t.path === f.path))
      .slice(0, 15)
      .map(f => `  - ${f.path}`);
    sourceFilesForInspection.push(...fallback);
  }

  // Risky file paths
  const riskyFilePaths = classifiedFiles.riskyFiles.map(r => r.file.path);

  // Missing signals list
  const missingSignalLines = missingSignals.length > 0
    ? missingSignals.map(s => `  - ${s}`)
    : ['  - No obvious missing signals detected.'];

  // Description (first 500 chars)
  const descriptionSnippet = mainIssueDescription.trim().slice(0, 500) || 'No description provided.';

  const lines: string[] = [
    `# PR Review Prompt for ${key}`,
    '',
    'Review this PR against the Jira requirement, not as a generic code review. ' +
    'Focus on requirement alignment, missing acceptance criteria, unrelated changes, risky changes, and test coverage.',
    '',
    '## Jira Requirement',
    '',
    `**Task:** ${key} — ${issueSummary}`,
    `**Status:** ${issueStatus}`,
    '',
    '**Description:**',
    descriptionSnippet,
    '',
    '**Acceptance Criteria:**',
    requirementSignals.acceptanceCriteria.length > 0
      ? requirementSignals.acceptanceCriteria.map(ac => `- ${ac}`).join('\n')
      : 'No explicit acceptance criteria found.',
    '',
    '## PR Context',
    '',
    `**Base branch:** ${input.baseBranch}`,
    `**Compare ref:** ${input.compareRef}`,
    `**Changed files (${allFiles.length} total):**`,
    changedFileLines.join('\n'),
    '',
    `**Test files changed:** ${classifiedFiles.testFiles.length}`,
    `**Risky files changed:** ${riskyFilePaths.length > 0 ? riskyFilePaths.join(', ') : 'None'}`,
    '',
    '## Review Instructions',
    '',
    '1. Inspect the following files in the repository to understand the change:',
    sourceFilesForInspection.length > 0 ? sourceFilesForInspection.join('\n') : '  - (no source files detected)',
    '',
    '2. Check whether each acceptance criterion is implemented:',
    acLines.join('\n'),
    '',
    '3. Look for missing implementations:',
    missingSignalLines.join('\n'),
    '',
    '4. Flag any unrelated changes that don\'t appear related to the Jira task.',
    '',
    '5. Verify that tests exist for changed behavior.',
    '',
    '6. Do not guess — if you cannot find evidence for or against a requirement, say "Not enough evidence."',
    '',
    '7. Produce a clear, actionable review finding for each acceptance criterion.',
  ];

  return lines.join('\n');
}
