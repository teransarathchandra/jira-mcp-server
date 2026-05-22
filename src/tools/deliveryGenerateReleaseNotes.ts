// ── Delivery Intelligence Layer — Generate Release Notes Tool ─────────────────
// MCP tool handler: fetch Jira context, optionally Confluence and PR diff, then
// generate audience-aware release notes.

import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { validateGitRef, resolveRepoPath } from '../utils/gitSafety.js';
import { fetchIssueContext, type ContextFetchOptions } from '../jira/issueContextService.js';
import { extractRequirements } from '../utils/requirementExtractor.js';
import { getDiffResult } from '../git/gitDiffService.js';
import { classifyChangedFiles } from '../utils/changedFileClassifier.js';
import { analyzeImpact } from '../delivery/impactAnalyzer.js';
import { generateReleaseNote } from '../delivery/releaseNoteGenerator.js';
import type { ReleaseNote, ReleaseAudience } from '../delivery/deliveryTypes.js';
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

export interface DeliveryGenerateReleaseNotesInput {
  issueKey: string;
  audience: ReleaseAudience;
  baseBranch: string;
  compareRef: string;
  repoPath: string;
  includeConfluence: boolean;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function audienceLabel(audience: ReleaseAudience): string {
  switch (audience) {
    case 'internal': return 'internal';
    case 'qa': return 'QA';
    case 'product': return 'product';
    case 'customer_safe': return 'customer-safe';
  }
}

function formatReleaseNote(note: ReleaseNote): string {
  const lines: string[] = [];

  lines.push(`# Release Note: ${note.issueKey}`);
  lines.push('');

  if (note.audience === 'customer_safe') {
    lines.push('> ⚠️ Customer-facing — internal details omitted');
    lines.push('');
  }

  lines.push(`> Issue: ${note.issueSummary}`);
  lines.push(`> Audience: ${audienceLabel(note.audience)}`);
  lines.push('');

  lines.push('## Summary');
  lines.push(note.summary);
  lines.push('');

  lines.push('## User Impact');
  lines.push(note.userImpact);
  lines.push('');

  if (note.audience !== 'customer_safe') {
    lines.push('## Technical Impact');
    lines.push(note.technicalImpact || '*(none detected)*');
    lines.push('');
  }

  lines.push('## Configuration / Migration Notes');
  if (note.configMigrationNotes.length > 0) {
    for (const item of note.configMigrationNotes) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('*(none)*');
  }
  lines.push('');

  if (note.audience !== 'customer_safe') {
    lines.push('## Risk Notes');
    if (note.riskNotes.length > 0) {
      for (const risk of note.riskNotes) {
        lines.push(`- ${risk}`);
      }
    } else {
      lines.push('*(none)*');
    }
    lines.push('');

    lines.push('## Rollback Notes');
    if (note.rollbackNotes.length > 0) {
      for (const item of note.rollbackNotes) {
        lines.push(`- ${item}`);
      }
    } else {
      lines.push('*(none)*');
    }
    lines.push('');

    if (note.qaNotes.length > 0) {
      lines.push('## QA Notes');
      for (const item of note.qaNotes) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }
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

export async function deliveryGenerateReleaseNotes(
  input: DeliveryGenerateReleaseNotesInput,
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

  // ── Step 7: Generate release note ──────────────────────────────────────────
  const releaseNote = generateReleaseNote({
    issueKey: key,
    issueSummary,
    issueDescription: mainIssueDescription,
    requirementSignals,
    classifiedFiles,
    changedFilePaths,
    impactAnalysis,
    audience: input.audience,
  });

  // ── Step 8: Format and return ──────────────────────────────────────────────
  return formatReleaseNote(releaseNote);
}
