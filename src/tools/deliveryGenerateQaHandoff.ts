// ── Delivery Intelligence Layer — Generate QA Handoff Tool ────────────────────
// MCP tool handler: fetch Jira context, optionally Confluence and PR diff, then
// generate a structured QA handoff document.

import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { validateGitRef, resolveRepoPath } from '../utils/gitSafety.js';
import { fetchIssueContext, type ContextFetchOptions } from '../jira/issueContextService.js';
import { extractRequirements } from '../utils/requirementExtractor.js';
import { getDiffResult } from '../git/gitDiffService.js';
import { classifyChangedFiles } from '../utils/changedFileClassifier.js';
import { analyzeImpact } from '../delivery/impactAnalyzer.js';
import { generateQaHandoff } from '../delivery/qaHandoffGenerator.js';
import type { QaHandoff } from '../delivery/deliveryTypes.js';
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

export interface DeliveryGenerateQaHandoffInput {
  issueKey: string;
  baseBranch: string;
  compareRef: string;
  repoPath: string;
  includeConfluence: boolean;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatQaHandoff(handoff: QaHandoff): string {
  const lines: string[] = [];

  lines.push(`# QA Handoff: ${handoff.issueKey}`);
  lines.push('');
  lines.push(`> Issue: ${handoff.issueSummary}`);
  lines.push('');

  lines.push('## Feature / Fix Summary');
  lines.push(handoff.featureSummary);
  lines.push('');

  lines.push('## Business Goal');
  lines.push(handoff.businessGoal);
  lines.push('');

  lines.push('## What Changed');
  if (handoff.whatChanged.length > 0) {
    for (const file of handoff.whatChanged) {
      lines.push(`- ${file}`);
    }
  } else {
    lines.push('*(no source files changed)*');
  }
  lines.push('');

  lines.push('## What To Test');
  if (handoff.whatToTest.length > 0) {
    for (const item of handoff.whatToTest) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('*(no specific test items identified)*');
  }
  lines.push('');

  lines.push('## What Not To Test');
  for (const item of handoff.whatNotToTest) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  lines.push('## Test Data / Preconditions');
  for (const item of handoff.testDataPreconditions) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  lines.push('## User Roles');
  lines.push(`- ${handoff.userRoles.join(', ')}`);
  lines.push('');

  lines.push('## Happy Path');
  for (let i = 0; i < handoff.happyPath.length; i++) {
    lines.push(`${i + 1}. ${handoff.happyPath[i]}`);
  }
  lines.push('');

  lines.push('## Negative Cases');
  if (handoff.negativeCases.length > 0) {
    for (const item of handoff.negativeCases) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('*(none identified)*');
  }
  lines.push('');

  lines.push('## Regression Areas');
  if (handoff.regressionAreas.length > 0) {
    for (const area of handoff.regressionAreas) {
      lines.push(`- ${area}`);
    }
  } else {
    lines.push('*(none identified)*');
  }
  lines.push('');

  lines.push('## Known Risks');
  if (handoff.knownRisks.length > 0) {
    for (const risk of handoff.knownRisks) {
      lines.push(`- ${risk}`);
    }
  } else {
    lines.push('*(none identified)*');
  }
  lines.push('');

  lines.push('## Open Questions');
  if (handoff.openQuestions.length > 0) {
    for (const q of handoff.openQuestions) {
      lines.push(`- ${q}`);
    }
  } else {
    lines.push('*(none)*');
  }
  lines.push('');

  lines.push('## Changed Files Summary');
  if (handoff.changedFilesSummary.length > 0) {
    for (const item of handoff.changedFilesSummary) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('*(no files changed)*');
  }

  return lines.join('\n');
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

// ── Main function ─────────────────────────────────────────────────────────────

export async function deliveryGenerateQaHandoff(
  input: DeliveryGenerateQaHandoffInput,
  client: JiraClient,
  config: Config,
): Promise<string> {
  // ── Step 1: Validate inputs ─────────────────────────────────────────────────
  validateIssueKey(input.issueKey);

  if (input.baseBranch && input.compareRef) {
    validateGitRef(input.baseBranch);
    validateGitRef(input.compareRef);
  }

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
  const requirementSignals = extractRequirements(mainIssueDescription);

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
            .map((w) => w.replace(/[^a-zA-Z0-9_-]/g, ''))
            .filter((w) => w.length >= 6),
        ),
      ).slice(0, 20);

      const contextOptions: ConfluenceContextOptions = {
        jiraIssueKey: input.issueKey,
        jiraSummary: issueSummary,
        jiraLabels: fields.labels ?? [],
        jiraComponents: (fields.components ?? []).map((c: { name: string }) => c.name),
        jiraTechnicalTerms: technicalTerms,
        jiraBusinessTerms: [],
        jiraLinkedIssueSummaries: jiraContext.linkedIssues.map((li) => li.summary),
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
        .map((p) => p.bodyMarkdown)
        .join('\n\n');

      if (allConfluenceText.trim()) {
        confluenceSignals = extractRequirements(allConfluenceText);
      }
    } catch {
      // Confluence fetch failed — proceed without Confluence signals
    }
  }

  // ── Step 5: Analyze impact ──────────────────────────────────────────────────
  const components = (fields.components ?? []).map((c: { name: string }) => c.name);
  const labels: string[] = fields.labels ?? [];
  const linkedIssueSummaries = jiraContext.linkedIssues.map((li) => li.summary);

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

  // ── Step 6: Get git diff + classify files (gracefully skip if no repo) ──────
  let changedFilePaths: string[] = [];
  let classifiedFiles: ClassifiedFiles = emptyClassifiedFiles();

  try {
    const resolvedPath = resolveRepoPath(input.repoPath);
    const diffResult = await getDiffResult(
      resolvedPath,
      input.baseBranch,
      input.compareRef,
    );
    changedFilePaths = diffResult.changedFiles.map((f) => f.path);
    classifiedFiles = classifyChangedFiles(diffResult.changedFiles);
  } catch {
    // Diff failed — proceed without diff signals
  }

  // ── Step 7: Generate QA handoff ─────────────────────────────────────────────
  const handoff = generateQaHandoff({
    issueKey: key,
    issueSummary,
    issueDescription: mainIssueDescription,
    requirementSignals,
    confluenceSignals,
    classifiedFiles,
    diffText: null,
    changedFilePaths,
    impactAnalysis,
  });

  // ── Step 8: Format and return ──────────────────────────────────────────────
  return formatQaHandoff(handoff);
}
