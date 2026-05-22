// ── Delivery Intelligence Layer — Export Task Report Tool ─────────────────────
// Meta-orchestrator: fetch Jira context, call the relevant tool functions for
// the requested sections, assemble all markdown, and export the combined report.

import { JiraClient } from '../jiraClient.js';
import { Config } from '../config.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { exportTaskReport, type ReportSection } from '../delivery/exportTaskReport.js';

// ── Section tool imports ──────────────────────────────────────────────────────

import { getIssueContext } from './getIssueContext.js';
import { deliveryAnalyzeImplementationImpact } from './deliveryAnalyzeImplementationImpact.js';
import { deliveryGetTraceabilityMatrix } from './deliveryGetTraceabilityMatrix.js';
import { deliveryVerifyDefinitionOfDone } from './deliveryVerifyDefinitionOfDone.js';
import { deliveryGenerateTestStrategy } from './deliveryGenerateTestStrategy.js';
import { deliveryGenerateQaHandoff } from './deliveryGenerateQaHandoff.js';
import { deliveryGenerateReleaseNotes } from './deliveryGenerateReleaseNotes.js';
import { reviewPrAlignment } from './reviewPrAlignment.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface DeliveryExportTaskReportInput {
  issueKey: string;
  baseBranch: string;
  compareRef: string;
  repoPath: string;
  includeConfluence: boolean;
  sections: string[];   // subset of valid section names
  outputPath?: string;
  overwrite?: boolean;
}

// ── Valid section names ────────────────────────────────────────────────────────

const VALID_SECTIONS: ReportSection[] = [
  'context',
  'impact',
  'traceability',
  'pr_alignment',
  'definition_of_done',
  'test_strategy',
  'qa_handoff',
  'release_notes',
];

// ── Main function ─────────────────────────────────────────────────────────────

export async function deliveryExportTaskReport(
  input: DeliveryExportTaskReportInput,
  client: JiraClient,
  config: Config,
): Promise<string> {
  // ── Step 1: Validate issue key ─────────────────────────────────────────────
  validateIssueKey(input.issueKey);

  // ── Step 2: Normalise requested sections ──────────────────────────────────
  const requestedSections: ReportSection[] = input.sections
    .map((s) => s.trim() as ReportSection)
    .filter((s) => VALID_SECTIONS.includes(s));

  // ── Step 3: Call each section's tool function ──────────────────────────────
  let contextMarkdown: string | undefined;
  let impactMarkdown: string | undefined;
  let traceabilityMarkdown: string | undefined;
  let prAlignmentMarkdown: string | undefined;
  let definitionOfDoneMarkdown: string | undefined;
  let testStrategyMarkdown: string | undefined;
  let qaHandoffMarkdown: string | undefined;
  let releaseNotesMarkdown: string | undefined;

  // We need the issue summary for the report header — fetch it as part of
  // the context section if requested, or with a lightweight fetch otherwise.
  let issueSummary = input.issueKey;

  for (const section of requestedSections) {
    switch (section) {
      case 'context': {
        contextMarkdown = await getIssueContext(
          { issueKey: input.issueKey },
          client,
          config,
        );
        break;
      }

      case 'impact': {
        impactMarkdown = await deliveryAnalyzeImplementationImpact(
          { issueKey: input.issueKey, includeConfluence: input.includeConfluence },
          client,
          config,
        );
        break;
      }

      case 'traceability': {
        traceabilityMarkdown = await deliveryGetTraceabilityMatrix(
          {
            issueKey: input.issueKey,
            baseBranch: input.baseBranch,
            compareRef: input.compareRef,
            repoPath: input.repoPath,
            includeConfluence: input.includeConfluence,
            includePrDiff: true,
          },
          client,
          config,
        );
        break;
      }

      case 'pr_alignment': {
        prAlignmentMarkdown = await reviewPrAlignment(
          {
            issueKey: input.issueKey,
            mode: 'local_diff',
            baseBranch: input.baseBranch,
            compareRef: input.compareRef,
            repoPath: input.repoPath,
          },
          client,
          config,
        );
        break;
      }

      case 'definition_of_done': {
        definitionOfDoneMarkdown = await deliveryVerifyDefinitionOfDone(
          {
            issueKey: input.issueKey,
            baseBranch: input.baseBranch,
            compareRef: input.compareRef,
            repoPath: input.repoPath,
            includeConfluence: input.includeConfluence,
          },
          client,
          config,
        );
        break;
      }

      case 'test_strategy': {
        testStrategyMarkdown = await deliveryGenerateTestStrategy(
          {
            issueKey: input.issueKey,
            includeConfluence: input.includeConfluence,
            includePrDiff: true,
            baseBranch: input.baseBranch,
            compareRef: input.compareRef,
            repoPath: input.repoPath,
          },
          client,
          config,
        );
        break;
      }

      case 'qa_handoff': {
        qaHandoffMarkdown = await deliveryGenerateQaHandoff(
          {
            issueKey: input.issueKey,
            baseBranch: input.baseBranch,
            compareRef: input.compareRef,
            repoPath: input.repoPath,
            includeConfluence: input.includeConfluence,
          },
          client,
          config,
        );
        break;
      }

      case 'release_notes': {
        releaseNotesMarkdown = await deliveryGenerateReleaseNotes(
          {
            issueKey: input.issueKey,
            audience: 'internal',
            baseBranch: input.baseBranch,
            compareRef: input.compareRef,
            repoPath: input.repoPath,
            includeConfluence: input.includeConfluence,
          },
          client,
          config,
        );
        break;
      }
    }
  }

  // ── Step 4: Try to extract issue summary from any generated markdown ───────
  // Look for "> Issue: ..." pattern from any section's markdown
  const allMarkdown = [
    contextMarkdown,
    impactMarkdown,
    traceabilityMarkdown,
    prAlignmentMarkdown,
    definitionOfDoneMarkdown,
    testStrategyMarkdown,
    qaHandoffMarkdown,
    releaseNotesMarkdown,
  ]
    .filter(Boolean)
    .join('\n');

  const summaryMatch = allMarkdown.match(/^> Issue: (.+)$/m);
  if (summaryMatch) {
    issueSummary = summaryMatch[1].trim();
  }

  // ── Step 5: Assemble and export report ────────────────────────────────────
  const result = exportTaskReport({
    issueKey: input.issueKey,
    issueSummary,
    sections: requestedSections,
    contextMarkdown,
    impactMarkdown,
    traceabilityMarkdown,
    prAlignmentMarkdown,
    definitionOfDoneMarkdown,
    testStrategyMarkdown,
    qaHandoffMarkdown,
    releaseNotesMarkdown,
    outputPath: input.outputPath,
    overwrite: input.overwrite,
  });

  if (result.writtenToFile) {
    return `# Report Written\n\nReport written to: ${result.outputPath}\n\n${result.content}`;
  }

  return result.content;
}
