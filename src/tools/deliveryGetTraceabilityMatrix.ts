// ── Delivery Intelligence Layer — Traceability Matrix Tool ────────────────────
// MCP tool handler: fetch Jira context, optionally fetch Confluence context and
// git diff, then build and format a requirement-to-code traceability matrix.

import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { validateGitRef, resolveRepoPath } from '../utils/gitSafety.js';
import { fetchIssueContext, type ContextFetchOptions } from '../jira/issueContextService.js';
import { extractRequirements } from '../utils/requirementExtractor.js';
import { getDiffResult } from '../git/gitDiffService.js';
import { classifyChangedFiles } from '../utils/changedFileClassifier.js';
import { buildTraceabilityMatrix } from '../delivery/traceabilityMatrix.js';
import type { TraceabilityMatrix, TraceabilityItem } from '../delivery/deliveryTypes.js';
import type { ClassifiedFiles } from '../utils/changedFileClassifier.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';

// Confluence imports (conditional — Confluence may not be configured)
import { isConfluenceEnabled, getConfluenceConfig } from '../confluence/confluenceConfig.js';
import { ConfluenceClient } from '../confluence/confluenceClient.js';
import {
  fetchConfluenceContext,
  type ConfluenceContextOptions,
} from '../confluence/confluenceContextService.js';
import { adfToMarkdown } from '../utils/adfToMarkdown.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface DeliveryGetTraceabilityMatrixInput {
  issueKey: string;
  baseBranch: string;
  compareRef: string;
  repoPath: string;
  includeConfluence: boolean;
  includePrDiff: boolean;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function statusEmoji(status: TraceabilityItem['coverageStatus']): string {
  switch (status) {
    case 'COVERED': return 'COVERED';
    case 'PARTIALLY_COVERED': return 'PARTIAL';
    case 'MISSING': return 'MISSING';
    case 'NOT_ENOUGH_EVIDENCE': return 'INSUFFICIENT';
    case 'NOT_APPLICABLE': return 'N/A';
    default: return status;
  }
}

function sourceLabel(item: TraceabilityItem): string {
  switch (item.source) {
    case 'acceptance_criteria': return `Jira AC (${item.sourceAuthority === 'high' ? 'High' : 'Med'})`;
    case 'business_rule': return `Jira BR (Med)`;
    case 'confluence': return `Confluence (Med)`;
    default: return item.source;
  }
}

function formatFilesCell(files: string[]): string {
  if (files.length === 0) return '—';
  return files
    .map(f => f.split('/').pop() ?? f)
    .slice(0, 2)
    .join(', ') + (files.length > 2 ? ` +${files.length - 2}` : '');
}

function formatMatrix(matrix: TraceabilityMatrix, noDiffNote?: string): string {
  const lines: string[] = [];

  lines.push(`# Requirement-to-Code Traceability Matrix: ${matrix.issueKey}`);
  lines.push('');
  lines.push(`> Issue: ${matrix.issueSummary}`);
  lines.push(`> Generated: ${matrix.generatedAt}`);
  if (noDiffNote) {
    lines.push(`> Note: ${noDiffNote}`);
  }
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push(`- Total requirements: ${matrix.totalRequirements}`);
  lines.push(`- Covered: ${matrix.covered}`);
  lines.push(`- Partially covered: ${matrix.partial}`);
  lines.push(`- Missing: ${matrix.missing}`);
  lines.push(`- Not enough evidence: ${matrix.notEnoughEvidence}`);
  lines.push(`- Not applicable: ${matrix.notApplicable}`);
  lines.push('');

  if (matrix.items.length === 0) {
    lines.push('*No requirements extracted from this issue.*');
    return lines.join('\n');
  }

  // Matrix table
  lines.push('## Traceability Matrix');
  lines.push('');
  lines.push('| # | Requirement | Source | Matched Files | Tests | Status | Confidence |');
  lines.push('|---|---|---|---|---|---|---|');

  for (const item of matrix.items) {
    const reqText = truncate(item.requirementText, 80);
    const matchedFilesCell = formatFilesCell(item.matchedFiles);
    const testsCell = formatFilesCell(item.matchedTests);
    const status = statusEmoji(item.coverageStatus);
    lines.push(
      `| ${item.requirementId} | ${reqText} | ${sourceLabel(item)} | ${matchedFilesCell} | ${testsCell} | ${status} | ${item.confidence} |`,
    );
  }
  lines.push('');

  // Missing evidence section
  const missingItems = matrix.items.filter(i => i.coverageStatus === 'MISSING');
  if (missingItems.length > 0) {
    lines.push('## Missing Evidence');
    for (const item of missingItems) {
      lines.push(`- ${item.requirementId}: ${truncate(item.requirementText, 120)}`);
    }
    lines.push('');
  }

  // Partial evidence section
  const partialItems = matrix.items.filter(i => i.coverageStatus === 'PARTIALLY_COVERED');
  if (partialItems.length > 0) {
    lines.push('## Partial Evidence');
    for (const item of partialItems) {
      const detail = item.matchedFiles.length > 0
        ? `matched ${item.matchedFiles.length} file(s) but no tests`
        : `found diff evidence but no matched files`;
      lines.push(`- ${item.requirementId}: ${truncate(item.requirementText, 100)} — ${detail}`);
    }
    lines.push('');
  }

  // Insufficient evidence
  const insufficientItems = matrix.items.filter(i => i.coverageStatus === 'NOT_ENOUGH_EVIDENCE');
  if (insufficientItems.length > 0) {
    lines.push('## Insufficient Evidence');
    for (const item of insufficientItems) {
      lines.push(`- ${item.requirementId}: ${truncate(item.requirementText, 100)} — ${item.notes}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatUnrelatedChanges(classifiedFiles: ClassifiedFiles): string {
  const noise = [
    ...classifiedFiles.generatedFiles,
    ...classifiedFiles.lockFiles,
  ];
  if (noise.length === 0) return '';

  const lines: string[] = ['## Unrelated Changes', ''];
  for (const file of noise) {
    const category = classifiedFiles.lockFiles.some(f => f.path === file.path)
      ? 'lock file'
      : 'generated file';
    lines.push(`- \`${file.path}\` *(${category})*`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatRecommendedActions(matrix: TraceabilityMatrix, classifiedFiles?: ClassifiedFiles): string {
  const actions: string[] = [];

  if (matrix.missing > 0) {
    actions.push(
      `Review ${matrix.missing} requirement(s) with no implementation evidence — they may be unimplemented or the diff may not cover them.`,
    );
  }

  if (matrix.partial > 0) {
    actions.push(
      `Add test coverage for ${matrix.partial} partially-covered requirement(s).`,
    );
  }

  if (matrix.notEnoughEvidence > 0) {
    actions.push(
      `Re-run with a full (non-truncated) diff to improve coverage assessment for ${matrix.notEnoughEvidence} item(s).`,
    );
  }

  if (classifiedFiles) {
    if (classifiedFiles.migrationFiles.length > 0) {
      actions.push('Database migration files present — ensure migration is reviewed and tested.');
    }
    if (classifiedFiles.riskyFiles.some(r => r.reasons.includes('auth_or_permissions'))) {
      actions.push('Auth/permissions files changed — security review recommended.');
    }
  }

  if (actions.length === 0) return '';

  const lines = ['## Recommended Actions Before Merge', ''];
  for (const action of actions) {
    lines.push(`- ${action}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function deliveryGetTraceabilityMatrix(
  input: DeliveryGetTraceabilityMatrixInput,
  client: JiraClient,
  config: Config,
): Promise<string> {
  // ── Step 1: Validate inputs ─────────────────────────────────────────────────
  validateIssueKey(input.issueKey);

  if (input.includePrDiff) {
    validateGitRef(input.baseBranch);
    validateGitRef(input.compareRef);
  }

  // ── Step 2: Fetch Jira context ──────────────────────────────────────────────
  const fetchOptions: ContextFetchOptions = {
    includeComments: false,
    includeParent: true,
    includeEpic: false,
    includeLinkedIssues: false,
    includeSubtasks: false,
    includeEpicSiblings: false,
    maxLinkedIssues: 0,
    maxSubtasks: 0,
    maxCommentsPerIssue: 0,
    contextDepth: 1,
  };

  const jiraContext = await fetchIssueContext(input.issueKey, fetchOptions, client, config);
  const { key, fields } = jiraContext.mainIssue;
  const issueSummary = fields.summary;
  const mainIssueDescription = jiraContext.mainIssueDescription;

  // ── Step 3: Extract Jira requirement signals ────────────────────────────────
  const requirementSignals = extractRequirements(mainIssueDescription);

  // ── Step 4: Optionally fetch Confluence context ─────────────────────────────
  let confluenceSignals: RequirementSignals | null = null;

  if (input.includeConfluence && isConfluenceEnabled()) {
    try {
      const confluenceConfig = getConfluenceConfig()!;

      // Extract confluence links from description
      const confluenceLinkRegex = /https?:\/\/[^\s]+atlassian\.net\/wiki\/[^\s]+/g;
      const confluenceLinks = mainIssueDescription.match(confluenceLinkRegex) ?? [];

      const technicalTerms = Array.from(
        new Set(
          mainIssueDescription
            .split(/\s+/)
            .map(w => w.replace(/[^a-zA-Z0-9_-]/g, ''))
            .filter(w => w.length >= 6),
        ),
      ).slice(0, 20);

      const contextOptions: ConfluenceContextOptions = {
        jiraIssueKey: input.issueKey,
        jiraSummary: issueSummary,
        jiraLabels: fields.labels ?? [],
        jiraComponents: (fields.components ?? []).map((c: { name: string }) => c.name),
        jiraTechnicalTerms: technicalTerms,
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

      // Combine all high+medium relevance page bodies for requirement extraction
      const allConfluenceText = [
        ...confluenceContext.highRelevancePages,
        ...confluenceContext.mediumRelevancePages,
      ]
        .map(p => p.bodyMarkdown)
        .join('\n\n');

      if (allConfluenceText.trim()) {
        confluenceSignals = extractRequirements(allConfluenceText);
      }
    } catch {
      // Confluence fetch failed — proceed without Confluence signals
    }
  }

  // ── Step 5: Optionally get git diff ────────────────────────────────────────
  let diffText = '';
  let diffTruncated = false;
  let changedFilePaths: string[] = [];
  let classifiedFiles: ClassifiedFiles = {
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
  let noDiffNote: string | undefined;
  let diffError: string | undefined;

  if (input.includePrDiff) {
    try {
      const resolvedPath = resolveRepoPath(input.repoPath);
      const diffResult = await getDiffResult(
        resolvedPath,
        input.baseBranch,
        input.compareRef,
      );

      diffText = diffResult.diffText;
      diffTruncated = diffResult.truncated;
      changedFilePaths = diffResult.changedFiles.map(f => f.path);
      classifiedFiles = classifyChangedFiles(diffResult.changedFiles);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      diffError = message;
      noDiffNote = `Git diff failed: ${message}. Coverage analysis will show NOT_ENOUGH_EVIDENCE for all items.`;
    }
  } else {
    noDiffNote = 'No diff was analyzed (includePrDiff=false). Coverage assessment is unavailable.';
  }

  // ── Step 6: Build traceability matrix ──────────────────────────────────────
  const matrix = buildTraceabilityMatrix({
    issueKey: key,
    issueSummary,
    requirementSignals,
    confluenceSignals,
    classifiedFiles,
    diffText,
    diffTruncated,
    changedFilePaths,
  });

  // ── Step 7: Format and return markdown output ───────────────────────────────
  const output: string[] = [];

  output.push(formatMatrix(matrix, noDiffNote));

  const unrelatedSection = formatUnrelatedChanges(classifiedFiles);
  if (unrelatedSection) {
    output.push(unrelatedSection);
  }

  const actionsSection = formatRecommendedActions(matrix, classifiedFiles);
  if (actionsSection) {
    output.push(actionsSection);
  }

  // Append diff error details if present
  if (diffError) {
    output.push(`---\n\n*Diff error detail: ${diffError}*`);
  }

  return output.join('\n');
}
