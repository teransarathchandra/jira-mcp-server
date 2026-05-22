// ── Delivery Intelligence Layer — Generate Reviewer Report Tool ───────────────
// MCP tool handler: orchestrate Jira context, optional Confluence, git diff,
// impact analysis, traceability, and DoD to produce a persona-specific report.

import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { validateGitRef, resolveRepoPath } from '../utils/gitSafety.js';
import { fetchIssueContext, type ContextFetchOptions } from '../jira/issueContextService.js';
import { extractRequirements } from '../utils/requirementExtractor.js';
import { getDiffResult } from '../git/gitDiffService.js';
import { classifyChangedFiles } from '../utils/changedFileClassifier.js';
import { analyzeImpact } from '../delivery/impactAnalyzer.js';
import { buildTraceabilityMatrix } from '../delivery/traceabilityMatrix.js';
import { verifyDefinitionOfDone } from '../delivery/definitionOfDoneVerifier.js';
import { generateReviewerReport } from '../delivery/reviewerPersonaReport.js';
import type { ReviewerPersona, DoDResult } from '../delivery/deliveryTypes.js';
import type { ClassifiedFiles } from '../utils/changedFileClassifier.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';

// Confluence imports (conditional — Confluence may not be configured)
import { isConfluenceEnabled, getConfluenceConfig } from '../confluence/confluenceConfig.js';
import { ConfluenceClient } from '../confluence/confluenceClient.js';
import {
  fetchConfluenceContext,
  type ConfluenceContextOptions,
} from '../confluence/confluenceContextService.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface DeliveryGenerateReviewerReportInput {
  issueKey: string;
  persona: ReviewerPersona;
  baseBranch: string;
  compareRef: string;
  repoPath: string;
  includeConfluence: boolean;
}

// ── Persona title map ─────────────────────────────────────────────────────────

function personaTitle(persona: ReviewerPersona): string {
  switch (persona) {
    case 'product_reviewer': return 'Product Requirement Review';
    case 'frontend_reviewer': return 'Frontend Review';
    case 'backend_reviewer': return 'Backend Review';
    case 'qa_reviewer': return 'QA Review Report';
    case 'security_reviewer': return 'Security Review Report';
    case 'release_reviewer': return 'Release Review Report';
    default: return 'Review Report';
  }
}

// ── Empty classified files helper ────────────────────────────────────────────

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

function formatReviewerReport(
  issueKey: string,
  issueSummary: string,
  persona: ReviewerPersona,
  sections: Record<string, string[]>,
): string {
  const lines: string[] = [];

  const title = personaTitle(persona);
  lines.push(`# ${title}: ${issueKey}`);
  lines.push('');
  lines.push(`> Issue: ${issueSummary}`);
  lines.push(`> Persona: ${persona}`);
  lines.push('');

  for (const [sectionTitle, items] of Object.entries(sections)) {
    lines.push(`## ${sectionTitle}`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function deliveryGenerateReviewerReport(
  input: DeliveryGenerateReviewerReportInput,
  client: JiraClient,
  config: Config,
): Promise<string> {
  // ── Step 1: Validate inputs ─────────────────────────────────────────────────
  validateIssueKey(input.issueKey);
  validateGitRef(input.baseBranch);
  validateGitRef(input.compareRef);

  // ── Step 2: Fetch Jira context ──────────────────────────────────────────────
  const fetchOptions: ContextFetchOptions = {
    includeComments: false,
    includeParent: false,
    includeEpic: false,
    includeLinkedIssues: true,
    includeSubtasks: false,
    includeEpicSiblings: false,
    maxLinkedIssues: 10,
    maxSubtasks: 0,
    maxCommentsPerIssue: 0,
    contextDepth: 1,
  };

  const jiraContext = await fetchIssueContext(input.issueKey, fetchOptions, client, config);
  const { key, fields } = jiraContext.mainIssue;
  const issueSummary = fields.summary;
  const mainIssueDescription = jiraContext.mainIssueDescription;

  // ── Step 3: Extract Jira requirement signals ────────────────────────────────
  const requirementSignals: RequirementSignals = extractRequirements(mainIssueDescription);

  // ── Step 4: Optionally fetch Confluence context ─────────────────────────────
  let confluenceSignals: RequirementSignals | null = null;

  if (input.includeConfluence && isConfluenceEnabled()) {
    try {
      const confluenceConfig = getConfluenceConfig()!;

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
        jiraLinkedIssueSummaries: jiraContext.linkedIssues.map(li => li.summary),
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
        .map(p => p.bodyMarkdown)
        .join('\n\n');

      if (allConfluenceText.trim()) {
        confluenceSignals = extractRequirements(allConfluenceText);
      }
    } catch {
      // Confluence fetch failed — proceed without Confluence signals
    }
  }

  // ── Step 5: Get git diff (graceful skip on failure) ─────────────────────────
  let diffText: string | null = null;
  let diffTruncated = false;
  let changedFilePaths: string[] = [];
  let classifiedFiles: ClassifiedFiles = emptyClassifiedFiles();

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
  } catch {
    // Diff failed — proceed without diff signals
  }

  // ── Step 6: Analyze impact ──────────────────────────────────────────────────
  const components = (fields.components ?? []).map((c: { name: string }) => c.name);
  const labels: string[] = fields.labels ?? [];
  const linkedIssueSummaries = jiraContext.linkedIssues.map(li => li.summary);

  const impactAnalysis = analyzeImpact({
    issueKey: key,
    issueSummary,
    issueDescription: mainIssueDescription,
    requirementSignals,
    confluenceSignals,
    components,
    labels,
    linkedIssueSummaries,
  });

  // ── Step 7: Build traceability matrix ──────────────────────────────────────
  const traceabilityMatrix = buildTraceabilityMatrix({
    issueKey: key,
    issueSummary,
    requirementSignals,
    confluenceSignals,
    classifiedFiles,
    diffText: diffText ?? '',
    diffTruncated,
    changedFilePaths,
  });

  // ── Step 8: Run DoD verifier (skip if no diff) ─────────────────────────────
  let dodResult: DoDResult | null = null;

  if (diffText !== null) {
    try {
      dodResult = verifyDefinitionOfDone({
        issueKey: key,
        issueSummary,
        requirementSignals,
        classifiedFiles,
        diffText: diffText ?? '',
        diffTruncated,
        changedFileCount: changedFilePaths.length,
        jiraContextQualityScore: 50,
        hasBlockingConflicts: false,
        hasUnresolvedAmbiguities: requirementSignals.ambiguities.length > 0,
        hasBackendRequirement: impactAnalysis.backend.length > 0,
        hasFrontendRequirement: impactAnalysis.frontend.length > 0,
        matchResult: null,
        traceabilityMatrix,
        safetyCheckResult: null,
        confluenceConflictCount: 0,
      });
    } catch {
      // DoD verification failed — proceed without it
    }
  }

  // ── Step 9: Generate persona report ────────────────────────────────────────
  const report = generateReviewerReport({
    issueKey: key,
    issueSummary,
    issueDescription: mainIssueDescription,
    persona: input.persona,
    requirementSignals,
    confluenceSignals,
    classifiedFiles,
    diffText,
    changedFilePaths,
    impactAnalysis,
    traceabilityMatrix,
    dodResult,
  });

  // ── Step 10: Format and return ─────────────────────────────────────────────
  return formatReviewerReport(key, issueSummary, input.persona, report.sections);
}
