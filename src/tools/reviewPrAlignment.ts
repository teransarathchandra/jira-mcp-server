import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { validateGitRef, resolveRepoPath } from '../utils/gitSafety.js';
import { fetchIssueContext, ContextFetchOptions } from '../jira/issueContextService.js';
import { extractRequirements } from '../utils/requirementExtractor.js';
import { detectConflicts, formatConflicts } from '../utils/conflictDetector.js';
import { scoreContextQuality } from '../utils/contextQualityScorer.js';
import { isGitRepository, getDiffResult } from '../git/gitDiffService.js';
import { classifyChangedFiles } from '../utils/changedFileClassifier.js';
import { generateRepoInspectionHints } from '../utils/repoInspectionHintGenerator.js';
import { matchRequirementsToChanges } from '../utils/prRequirementMatcher.js';
import { scoreAlignment } from '../utils/alignmentScorer.js';
import { formatPrAlignmentReview } from '../utils/formatPrAlignmentReview.js';
import { isUsefulComment } from '../utils/commentAnalyzer.js';
import { adfToMarkdown } from '../utils/adfToMarkdown.js';
import { scoreLinkedIssues } from '../utils/relevanceScorer.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReviewPrAlignmentInput {
  issueKey: string;
  mode: 'local_diff' | 'github_pr';
  baseBranch: string;
  compareRef: string;
  prNumber?: number | null;
  repoPath: string;
  includeTests?: boolean;
  includeUnrelatedChangeDetection?: boolean;
  maxDiffChars?: number;
}

// ── Main function ──────────────────────────────────────────────────────────────

export async function reviewPrAlignment(
  input: ReviewPrAlignmentInput,
  client: JiraClient,
  config: Config,
): Promise<string> {
  // ── Step 1: Validate inputs ────────────────────────────────────────────────
  validateIssueKey(input.issueKey);
  validateGitRef(input.baseBranch);
  validateGitRef(input.compareRef);

  if (input.mode === 'github_pr') {
    throw new Error(
      'github_pr mode requires GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO environment variables. Use local_diff mode instead.',
    );
  }

  const MIN_DIFF_CHARS = 1000;
  const MAX_DIFF_CHARS = 200000;
  let effectiveMaxDiffChars = input.maxDiffChars ?? 50000;
  if (effectiveMaxDiffChars < MIN_DIFF_CHARS) effectiveMaxDiffChars = MIN_DIFF_CHARS;
  if (effectiveMaxDiffChars > MAX_DIFF_CHARS) effectiveMaxDiffChars = MAX_DIFF_CHARS;

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

  // ── Step 3: Extract requirement signals ───────────────────────────────────
  const requirementSignals = extractRequirements(mainIssueDescription);

  // ── Step 4: Detect conflicts ───────────────────────────────────────────────
  const commentInputs = fields.comment.comments.map(c => ({
    label: `comment by ${c.author.displayName}`,
    text: adfToMarkdown(c.body),
    date: c.created,
  }));

  const usefulComments = commentInputs.filter(c => isUsefulComment(c.text));

  const conflictSources = [
    { label: 'task description', text: mainIssueDescription, date: fields.created },
    ...usefulComments,
    ...(context.parentDescription ? [{ label: 'parent issue', text: context.parentDescription }] : []),
    ...(context.epicDescription ? [{ label: 'epic', text: context.epicDescription }] : []),
  ];
  const conflictResult = detectConflicts(conflictSources);

  // ── Step 5: Score context quality ─────────────────────────────────────────
  const hasBlockingIssues = context.linkedIssues.some(l =>
    l.relationship.toLowerCase().includes('block'),
  );

  const relevanceResult = scoreLinkedIssues({
    linkedIssues: context.linkedIssues,
    mainSummary: issueSummary,
    mainDescription: mainIssueDescription,
    mainComponents: fields.components.map(c => c.name),
    mainLabels: fields.labels,
    mainTechnicalSignals: requirementSignals.technicalSignals,
  });

  const qualityResult = scoreContextQuality({
    mainDescription: mainIssueDescription,
    hasAcceptanceCriteria: requirementSignals.acceptanceCriteria.length > 0,
    acceptanceCriteriaCount: requirementSignals.acceptanceCriteria.length,
    usefulCommentCount: usefulComments.length,
    technicalSignalCount: requirementSignals.technicalSignals.length,
    hasParentContext: context.parentIssue !== null,
    hasEpicContext: context.epicIssue !== null,
    linkedHighRelevanceCount: relevanceResult.high.length,
    conflictCount: conflictResult.conflicts.length,
    ambiguityCount: requirementSignals.ambiguities.length,
    hasBlockingIssues,
  });

  // ── Step 6: Get diff ───────────────────────────────────────────────────────
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
      effectiveMaxDiffChars,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      `Could not get diff: ${message}. ` +
      `Check that baseBranch '${input.baseBranch}' and compareRef '${input.compareRef}' exist in the repository.`
    );
  }

  // ── Step 7: Classify changed files ────────────────────────────────────────
  const classifiedFiles = classifyChangedFiles(diffResult.changedFiles);

  // ── Step 8: Detect backend/frontend requirements ───────────────────────────
  const combinedText = `${mainIssueDescription} ${issueSummary}`.toLowerCase();
  const hasBackendRequirement =
    /backend|(?<!\w)api(?!\w)|server|database|endpoint|service|migration|admin panel|validation on server/i.test(combinedText);
  const hasFrontendRequirement =
    /ui|frontend|page|component|form|screen|button|modal|view|display|style|css|layout/i.test(combinedText);

  // ── Step 9: Match requirements to changes ─────────────────────────────────
  const epicReqs = context.epicDescription ? extractRequirements(context.epicDescription) : null;

  const repoHints = generateRepoInspectionHints({
    technicalSignals: [
      ...requirementSignals.technicalSignals,
      ...(epicReqs?.technicalSignals ?? []),
    ],
    components: fields.components.map(c => c.name),
    labels: fields.labels,
    userRoles: requirementSignals.userRoles,
    linkedIssueSummaries: [...relevanceResult.high, ...relevanceResult.medium].map(i => i.summary),
    mainDescription: mainIssueDescription,
    summary: issueSummary,
  });

  const matchResult = matchRequirementsToChanges({
    requirementSignals,
    repoInspectionHints: repoHints.hints,
    classifiedFiles,
    diffText: diffResult.diffText,
    issueKey: key,
    issueSummary,
  });

  // ── Step 10: Score alignment ───────────────────────────────────────────────
  const alignmentResult = scoreAlignment({
    matchResult,
    requirementSignals,
    jiraContextQualityScore: qualityResult.score,
    diffTruncated: diffResult.truncated,
    totalChangedFileCount: diffResult.changedFiles.length,
    hasBackendRequirement,
    hasFrontendRequirement,
  });

  // ── Step 11: Format review ─────────────────────────────────────────────────
  const conflictsFormatted = formatConflicts(conflictResult);
  const jiraConflicts = conflictsFormatted
    ? conflictsFormatted.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2))
    : [];

  const review = formatPrAlignmentReview({
    issueKey: key,
    issueSummary,
    issueDescription: mainIssueDescription.slice(0, 400),
    acceptanceCriteria: requirementSignals.acceptanceCriteria,
    jiraConflicts,
    jiraAmbiguities: requirementSignals.ambiguities,
    diffResult,
    matchResult,
    alignmentResult,
  });

  return review;
}
