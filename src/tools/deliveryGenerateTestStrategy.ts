// ── Delivery Intelligence Layer — Generate Test Strategy Tool ─────────────────
// MCP tool handler: fetch Jira context, optionally Confluence and PR diff, then
// generate a practical test strategy.

import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { validateGitRef, resolveRepoPath } from '../utils/gitSafety.js';
import { fetchIssueContext, type ContextFetchOptions } from '../jira/issueContextService.js';
import { extractRequirements } from '../utils/requirementExtractor.js';
import { getDiffResult } from '../git/gitDiffService.js';
import { classifyChangedFiles } from '../utils/changedFileClassifier.js';
import { analyzeImpact } from '../delivery/impactAnalyzer.js';
import { generateTestStrategy } from '../delivery/testStrategyGenerator.js';
import type { TestStrategy, TestCase } from '../delivery/deliveryTypes.js';
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

export interface DeliveryGenerateTestStrategyInput {
  issueKey: string;
  includeConfluence: boolean;
  includePrDiff: boolean;
  baseBranch: string;
  compareRef: string;
  repoPath: string;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

type TestCaseCategory = TestCase['category'];

function categoryHeading(category: TestCaseCategory): string {
  switch (category) {
    case 'unit': return 'Unit Tests';
    case 'integration': return 'Integration Tests';
    case 'e2e': return 'E2E Tests';
    case 'manual': return 'Manual QA Checklist';
    case 'negative': return 'Negative Cases';
    case 'edge': return 'Edge Cases';
    case 'permission': return 'Permission / Security Tests';
    case 'migration': return 'Migration Tests';
    case 'api_contract': return 'API Contract Tests';
    case 'ui_responsiveness': return 'UI Responsiveness Tests';
    case 'regression': return 'Regression Tests';
    default: return 'Other Tests';
  }
}

const CATEGORY_ORDER: TestCaseCategory[] = [
  'unit',
  'integration',
  'e2e',
  'manual',
  'negative',
  'edge',
  'permission',
  'migration',
  'api_contract',
  'ui_responsiveness',
  'regression',
];

function formatTestStrategy(strategy: TestStrategy, includedPrDiff: boolean): string {
  const lines: string[] = [];

  lines.push(`# Test Strategy: ${strategy.issueKey}`);
  lines.push('');
  lines.push(`> Issue: ${strategy.issueSummary}`);
  lines.push('');

  lines.push('## Requirement Summary');
  lines.push(strategy.requirementSummary);
  lines.push('');

  lines.push('## Test Scope');
  lines.push(strategy.testScope);
  lines.push('');

  // Group test cases by category
  const grouped = new Map<TestCaseCategory, TestCase[]>();
  for (const tc of strategy.testCases) {
    if (!grouped.has(tc.category)) {
      grouped.set(tc.category, []);
    }
    grouped.get(tc.category)!.push(tc);
  }

  for (const category of CATEGORY_ORDER) {
    const cases = grouped.get(category);
    if (!cases || cases.length === 0) continue;

    lines.push(`## ${categoryHeading(category)}`);
    lines.push('');
    lines.push('| Priority | Test |');
    lines.push('|---|---|');
    for (const tc of cases) {
      lines.push(`| ${tc.priority} | ${tc.description} |`);
    }
    lines.push('');
  }

  // Regression areas
  lines.push('## Regression Areas');
  if (strategy.regressionAreas.length > 0) {
    for (const area of strategy.regressionAreas) {
      lines.push(`- ${area}`);
    }
  } else {
    lines.push('*(none identified)*');
  }
  lines.push('');

  // Missing test evidence (only show if PR diff was included)
  if (includedPrDiff) {
    lines.push('## Missing Test Evidence From PR');
    if (strategy.missingTestEvidence.length > 0) {
      for (const item of strategy.missingTestEvidence) {
        lines.push(`- ${item}`);
      }
    } else {
      lines.push('*(no missing evidence detected)*');
    }
    lines.push('');
  }

  // Suggested test data
  lines.push('## Suggested Test Data');
  if (strategy.suggestedTestData.length > 0) {
    for (const item of strategy.suggestedTestData) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('*(no specific test data required)*');
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

export async function deliveryGenerateTestStrategy(
  input: DeliveryGenerateTestStrategyInput,
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

  // ── Step 6: Optionally get diff + classify files ────────────────────────────
  let diffText: string | null = null;
  let changedTestFiles: string[] = [];
  let classifiedFiles: ClassifiedFiles = emptyClassifiedFiles();

  if (input.includePrDiff) {
    try {
      const resolvedPath = resolveRepoPath(input.repoPath);
      const diffResult = await getDiffResult(
        resolvedPath,
        input.baseBranch,
        input.compareRef,
      );
      diffText = diffResult.diffText;
      classifiedFiles = classifyChangedFiles(diffResult.changedFiles);
      changedTestFiles = classifiedFiles.testFiles.map((f) => f.path);
    } catch {
      // Diff failed — proceed without diff signals
    }
  }

  // ── Step 7: Generate test strategy ─────────────────────────────────────────
  const strategy = generateTestStrategy({
    issueKey: key,
    issueSummary,
    requirementSignals,
    confluenceSignals,
    impactAnalysis,
    diffText,
    changedTestFiles,
    classifiedFiles,
  });

  // ── Step 8: Format and return ──────────────────────────────────────────────
  return formatTestStrategy(strategy, input.includePrDiff);
}
