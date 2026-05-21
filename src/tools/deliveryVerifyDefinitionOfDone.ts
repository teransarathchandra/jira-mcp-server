// ── Delivery Intelligence Layer — Definition of Done Verifier Tool ────────────
// MCP tool handler: orchestrate Jira context, diff, safety, traceability, and
// requirement matching to verify if a task is ready for merge.

import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { validateGitRef, resolveRepoPath } from '../utils/gitSafety.js';
import { fetchIssueContext, type ContextFetchOptions } from '../jira/issueContextService.js';
import { extractRequirements } from '../utils/requirementExtractor.js';
import { detectConflicts, detectJiraConfluenceConflicts } from '../utils/conflictDetector.js';
import { scoreContextQuality } from '../utils/contextQualityScorer.js';
import { getDiffResult } from '../git/gitDiffService.js';
import { classifyChangedFiles } from '../utils/changedFileClassifier.js';
import { matchRequirementsToChanges } from '../utils/prRequirementMatcher.js';
import { generateRepoInspectionHints } from '../utils/repoInspectionHintGenerator.js';
import { runSafetyChecks } from '../delivery/deliverySafety.js';
import { buildTraceabilityMatrix } from '../delivery/traceabilityMatrix.js';
import { verifyDefinitionOfDone } from '../delivery/definitionOfDoneVerifier.js';
import { isUsefulComment } from '../utils/commentAnalyzer.js';
import { adfToMarkdown } from '../utils/adfToMarkdown.js';
import { scoreLinkedIssues } from '../utils/relevanceScorer.js';
import type { ClassifiedFiles } from '../utils/changedFileClassifier.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';
import type { DoDResult, DoDCheck } from '../delivery/deliveryTypes.js';

// Confluence imports (conditional — Confluence may not be configured)
import { isConfluenceEnabled, getConfluenceConfig } from '../confluence/confluenceConfig.js';
import { ConfluenceClient } from '../confluence/confluenceClient.js';
import {
  fetchConfluenceContext,
  type ConfluenceContextOptions,
} from '../confluence/confluenceContextService.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface DeliveryVerifyDoDInput {
  issueKey: string;
  baseBranch: string;
  compareRef: string;
  repoPath: string;
  includeConfluence: boolean;
}

// ── Empty classified files helper ─────────────────────────────────────────────

function emptyClassifiedFiles(): ClassifiedFiles {
  return {
    testFiles: [],
    configFiles: [],
    migrationFiles: [],
    lockFiles: [],
    generatedFiles: [],
    documentationFiles: [],
    sourceFiles: [],
    riskyFiles: [],
    backendFiles: [],
    frontendFiles: [],
  };
}

// ── Markdown formatting ───────────────────────────────────────────────────────

function checkStatusEmoji(status: DoDCheck['status']): string {
  switch (status) {
    case 'passed': return '✅';
    case 'failed': return '❌';
    case 'warning': return '⚠️';
    case 'skipped': return '⏭️';
    default: return '•';
  }
}

function formatDoDResult(result: DoDResult): string {
  const lines: string[] = [];

  lines.push(`# Definition of Done Verification: ${result.issueKey}`);
  lines.push('');
  lines.push(`> Issue: ${result.issueSummary}`);
  lines.push(`> Status: ${result.overallStatus}`);
  lines.push(`> Confidence: ${result.confidence}`);
  lines.push(`> Score: ${result.score}/100`);
  lines.push('');

  lines.push('## Verdict');
  lines.push(`**Status:** ${result.overallStatus}`);
  lines.push(`**Score:** ${result.score}/100`);
  lines.push(`**Confidence:** ${result.confidence}`);
  lines.push('');

  if (result.passedChecks.length > 0) {
    lines.push(`## Passed Checks (${result.passedChecks.length})`);
    for (const check of result.passedChecks) {
      lines.push(`- ${checkStatusEmoji(check.status)} ${check.checkName} — ${check.detail}`);
    }
    lines.push('');
  }

  if (result.failedChecks.length > 0) {
    lines.push(`## Failed Checks (${result.failedChecks.length})`);
    for (const check of result.failedChecks) {
      lines.push(`- ${checkStatusEmoji(check.status)} ${check.checkName} — ${check.detail}`);
    }
    lines.push('');
  }

  if (result.warningChecks.length > 0) {
    lines.push(`## Warning Checks (${result.warningChecks.length})`);
    for (const check of result.warningChecks) {
      lines.push(`- ${checkStatusEmoji(check.status)} ${check.checkName} — ${check.detail}`);
    }
    lines.push('');
  }

  if (result.requiredFixes.length > 0) {
    lines.push('## Required Fixes');
    result.requiredFixes.forEach((fix, i) => {
      lines.push(`${i + 1}. ${fix}`);
    });
    lines.push('');
  }

  if (result.recommendedFixes.length > 0) {
    lines.push('## Recommended Fixes');
    result.recommendedFixes.forEach((fix, i) => {
      lines.push(`${i + 1}. ${fix}`);
    });
    lines.push('');
  }

  if (result.humanReviewNeeded.length > 0) {
    lines.push('## Human Review Needed');
    for (const item of result.humanReviewNeeded) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function deliveryVerifyDefinitionOfDone(
  input: DeliveryVerifyDoDInput,
  client: JiraClient,
  config: Config,
): Promise<string> {
  // ── Step 1: Validate inputs ─────────────────────────────────────────────────
  validateIssueKey(input.issueKey);

  // ── Step 2: Fetch Jira context ──────────────────────────────────────────────
  const fetchOptions: ContextFetchOptions = {
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

  const jiraContext = await fetchIssueContext(input.issueKey, fetchOptions, client, config);
  const { key, fields } = jiraContext.mainIssue;
  const issueSummary = fields.summary;
  const mainIssueDescription = jiraContext.mainIssueDescription;

  // ── Step 3: Extract requirements ────────────────────────────────────────────
  const requirementSignals = extractRequirements(mainIssueDescription);

  // ── Step 4: Detect conflicts + score context quality ───────────────────────
  const commentInputs = (fields.comment?.comments ?? []).map((c: {
    author: { displayName: string };
    body: unknown;
    created: string;
  }) => ({
    label: `comment by ${c.author.displayName}`,
    text: adfToMarkdown(c.body),
    date: c.created,
  }));

  const usefulComments = commentInputs.filter((c: { text: string }) => isUsefulComment(c.text));

  const conflictSources = [
    { label: 'task description', text: mainIssueDescription, date: fields.created },
    ...usefulComments,
    ...(jiraContext.parentDescription ? [{ label: 'parent issue', text: jiraContext.parentDescription }] : []),
    ...(jiraContext.epicDescription ? [{ label: 'epic', text: jiraContext.epicDescription }] : []),
  ];
  const conflictResult = detectConflicts(conflictSources);

  const hasBlockingIssues = jiraContext.linkedIssues.some((l: { relationship: string }) =>
    l.relationship.toLowerCase().includes('block'),
  );

  const relevanceResult = scoreLinkedIssues({
    linkedIssues: jiraContext.linkedIssues,
    mainSummary: issueSummary,
    mainDescription: mainIssueDescription,
    mainComponents: (fields.components ?? []).map((c: { name: string }) => c.name),
    mainLabels: fields.labels ?? [],
    mainTechnicalSignals: requirementSignals.technicalSignals,
  });

  const qualityResult = scoreContextQuality({
    mainDescription: mainIssueDescription,
    hasAcceptanceCriteria: requirementSignals.acceptanceCriteria.length > 0,
    acceptanceCriteriaCount: requirementSignals.acceptanceCriteria.length,
    usefulCommentCount: usefulComments.length,
    technicalSignalCount: requirementSignals.technicalSignals.length,
    hasParentContext: jiraContext.parentIssue !== null,
    hasEpicContext: jiraContext.epicIssue !== null,
    linkedHighRelevanceCount: relevanceResult.high.length,
    conflictCount: conflictResult.conflicts.length,
    ambiguityCount: requirementSignals.ambiguities.length,
    hasBlockingIssues,
  });

  // ── Step 5: Detect backend/frontend requirements ────────────────────────────
  const combinedText = `${mainIssueDescription} ${issueSummary}`.toLowerCase();
  const hasBackendRequirement =
    /backend|(?<!\w)api(?!\w)|server|database|endpoint|service|migration|admin panel|validation on server/i.test(combinedText);
  const hasFrontendRequirement =
    /ui|frontend|page|component|form|screen|button|modal|view|display|style|css|layout/i.test(combinedText);

  // ── Step 6: Get git diff (optional — skip if not a valid git repo) ──────────
  let diffText = '';
  let diffTruncated = false;
  let changedFileCount = 0;
  let classifiedFiles: ClassifiedFiles = emptyClassifiedFiles();
  let isGitRepo = true;

  // Validate git refs only if we're going to attempt a diff
  try {
    validateGitRef(input.baseBranch);
    validateGitRef(input.compareRef);
  } catch {
    isGitRepo = false;
  }

  if (isGitRepo) {
    try {
      const resolvedPath = resolveRepoPath(input.repoPath);
      const diffResult = await getDiffResult(
        resolvedPath,
        input.baseBranch,
        input.compareRef,
      );

      diffText = diffResult.diffText;
      diffTruncated = diffResult.truncated;
      changedFileCount = diffResult.changedFiles.length;
      classifiedFiles = classifyChangedFiles(diffResult.changedFiles);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.toLowerCase().includes('not a git repository') ||
        message.toLowerCase().includes('not a valid')
      ) {
        isGitRepo = false;
      }
      // If it's a different error, proceed with empty diff
    }
  }

  // ── Step 7: Run safety checks ───────────────────────────────────────────────
  // Collect all changed files across all buckets for the safety check input
  const allChangedFilesForSafety = isGitRepo
    ? [
        ...classifiedFiles.testFiles,
        ...classifiedFiles.sourceFiles,
        ...classifiedFiles.backendFiles,
        ...classifiedFiles.frontendFiles,
        ...classifiedFiles.migrationFiles,
        ...classifiedFiles.configFiles,
        ...classifiedFiles.lockFiles,
        ...classifiedFiles.generatedFiles,
        ...classifiedFiles.documentationFiles,
      ].filter((v, i, a) => a.findIndex(x => x.path === v.path) === i)
    : [];

  const safetyCheckResult = runSafetyChecks({
    diffResult: isGitRepo
      ? {
          changedFiles: allChangedFilesForSafety,
          diffText,
          originalDiffLength: diffText.length,
          truncated: diffTruncated,
        }
      : undefined,
    classifiedFiles: isGitRepo ? classifiedFiles : undefined,
    requirementSignals,
  });

  // ── Step 8: Match requirements to changes ───────────────────────────────────
  const epicReqs = jiraContext.epicDescription
    ? extractRequirements(jiraContext.epicDescription)
    : null;

  const repoHints = generateRepoInspectionHints({
    technicalSignals: [
      ...requirementSignals.technicalSignals,
      ...(epicReqs?.technicalSignals ?? []),
    ],
    components: (fields.components ?? []).map((c: { name: string }) => c.name),
    labels: fields.labels ?? [],
    userRoles: requirementSignals.userRoles,
    linkedIssueSummaries: [...relevanceResult.high, ...relevanceResult.medium].map(
      (i: { summary: string }) => i.summary,
    ),
    mainDescription: mainIssueDescription,
    summary: issueSummary,
  });

  const matchResult = isGitRepo
    ? matchRequirementsToChanges({
        requirementSignals,
        repoInspectionHints: repoHints.hints,
        classifiedFiles,
        diffText,
        issueKey: key,
        issueSummary,
      })
    : null;

  // ── Step 9: Optionally fetch Confluence context ─────────────────────────────
  let confluenceSignals: RequirementSignals | null = null;
  let confluenceConflictCount = 0;

  if (input.includeConfluence && isConfluenceEnabled()) {
    try {
      const confluenceConfig = getConfluenceConfig()!;

      const confluenceLinkRegex = /https?:\/\/[^\s]+atlassian\.net\/wiki\/[^\s]+/g;
      const confluenceLinks = mainIssueDescription.match(confluenceLinkRegex) ?? [];

      const technicalTerms = Array.from(
        new Set(
          mainIssueDescription
            .split(/\s+/)
            .map((w: string) => w.replace(/[^a-zA-Z0-9_-]/g, ''))
            .filter((w: string) => w.length >= 6),
        ),
      ).slice(0, 20);

      const contextOptions: ConfluenceContextOptions = {
        jiraIssueKey: input.issueKey,
        jiraSummary: issueSummary,
        jiraLabels: fields.labels ?? [],
        jiraComponents: (fields.components ?? []).map((c: { name: string }) => c.name),
        jiraTechnicalTerms: technicalTerms as string[],
        jiraBusinessTerms: [],
        jiraLinkedIssueSummaries: [],
        confluenceLinksFromJira: confluenceLinks,
        maxSearchResults: confluenceConfig.maxSearchResults,
        maxPagesToRead: confluenceConfig.maxPagesToRead,
        maxPageChars: confluenceConfig.maxPageChars,
      };

      const confluenceClient = new ConfluenceClient(confluenceConfig);
      const confluenceContext = await fetchConfluenceContext(
        contextOptions,
        confluenceClient,
        confluenceConfig,
      );

      const allConfluenceText = [
        ...confluenceContext.highRelevancePages,
        ...confluenceContext.mediumRelevancePages,
      ]
        .map((p: { bodyMarkdown: string }) => p.bodyMarkdown)
        .join('\n\n');

      if (allConfluenceText.trim()) {
        confluenceSignals = extractRequirements(allConfluenceText);
      }

      // Detect Jira vs Confluence conflicts
      const allConfluencePages = [
        ...confluenceContext.highRelevancePages,
        ...confluenceContext.mediumRelevancePages,
      ];

      if (allConfluencePages.length > 0) {
        const jiraConfluenceConflictResult = detectJiraConfluenceConflicts(
          conflictSources,
          allConfluencePages.map((p: { title: string; bodyMarkdown: string; url: string; lastUpdated: string; isStale?: boolean }) => ({
            title: p.title,
            bodyMarkdown: p.bodyMarkdown,
            url: p.url,
            isStale: p.isStale ?? false,
            lastUpdated: p.lastUpdated,
          })),
        );
        confluenceConflictCount = jiraConfluenceConflictResult.conflicts.length;
      }
    } catch {
      // Confluence fetch failed — proceed without Confluence signals
    }
  }

  // ── Step 10: Build traceability matrix ──────────────────────────────────────
  const changedFilePaths = [
    ...classifiedFiles.testFiles,
    ...classifiedFiles.sourceFiles,
    ...classifiedFiles.backendFiles,
    ...classifiedFiles.frontendFiles,
    ...classifiedFiles.migrationFiles,
    ...classifiedFiles.configFiles,
    ...classifiedFiles.lockFiles,
    ...classifiedFiles.generatedFiles,
    ...classifiedFiles.documentationFiles,
  ]
    .map(f => f.path)
    .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

  const traceabilityMatrix = buildTraceabilityMatrix({
    issueKey: key,
    issueSummary,
    requirementSignals,
    confluenceSignals,
    classifiedFiles,
    diffText,
    diffTruncated,
    changedFilePaths,
  });

  // ── Step 11: Run DoD verification ───────────────────────────────────────────
  const hasBlockingConflicts =
    conflictResult.conflicts.some(c => c.severity === 'high') || safetyCheckResult.hasCriticalWarnings;

  const hasUnresolvedAmbiguities = requirementSignals.ambiguities.length > 0;

  const dodResult = verifyDefinitionOfDone({
    issueKey: key,
    issueSummary,
    requirementSignals,
    classifiedFiles,
    diffText,
    diffTruncated,
    changedFileCount,
    jiraContextQualityScore: qualityResult.score,
    hasBlockingConflicts,
    hasUnresolvedAmbiguities,
    hasBackendRequirement,
    hasFrontendRequirement,
    matchResult,
    traceabilityMatrix,
    safetyCheckResult,
    confluenceConflictCount,
  });

  // ── Step 12: Format markdown output ─────────────────────────────────────────
  return formatDoDResult(dodResult);
}
