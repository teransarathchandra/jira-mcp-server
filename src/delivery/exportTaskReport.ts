// ── Delivery Intelligence Layer — Export Task Report ──────────────────────────
// Export a single markdown delivery report combining multiple sections.
// Pure assembly logic — callers are responsible for generating each section's
// markdown content; this module only combines and optionally writes to disk.

import { existsSync, writeFileSync } from 'node:fs';

// ── Input / Output types ───────────────────────────────────────────────────────

export type ReportSection =
  | 'context'
  | 'impact'
  | 'traceability'
  | 'pr_alignment'
  | 'definition_of_done'
  | 'test_strategy'
  | 'qa_handoff'
  | 'release_notes';

export interface ExportTaskReportInput {
  issueKey: string;
  issueSummary: string;
  sections: ReportSection[];
  contextMarkdown?: string;
  impactMarkdown?: string;
  traceabilityMarkdown?: string;
  prAlignmentMarkdown?: string;
  definitionOfDoneMarkdown?: string;
  testStrategyMarkdown?: string;
  qaHandoffMarkdown?: string;
  releaseNotesMarkdown?: string;
  outputPath?: string;        // if provided, write to file; else return as string
  overwrite?: boolean;
}

export interface ExportTaskReportResult {
  content: string;
  writtenToFile: boolean;
  outputPath?: string;
}

// ── Helper: map section key to markdown content ───────────────────────────────

function getSectionMarkdown(
  section: ReportSection,
  input: ExportTaskReportInput,
): string | undefined {
  switch (section) {
    case 'context':           return input.contextMarkdown;
    case 'impact':            return input.impactMarkdown;
    case 'traceability':      return input.traceabilityMarkdown;
    case 'pr_alignment':      return input.prAlignmentMarkdown;
    case 'definition_of_done': return input.definitionOfDoneMarkdown;
    case 'test_strategy':     return input.testStrategyMarkdown;
    case 'qa_handoff':        return input.qaHandoffMarkdown;
    case 'release_notes':     return input.releaseNotesMarkdown;
    default:                  return undefined;
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

export function exportTaskReport(input: ExportTaskReportInput): ExportTaskReportResult {
  const now = new Date().toISOString();
  const sectionList = input.sections.join(', ');

  const headerLines: string[] = [
    `# Delivery Report: ${input.issueKey}`,
    '',
    `> Issue: ${input.issueSummary}`,
    `> Generated: ${now}`,
    `> Sections: ${sectionList}`,
    '',
    '---',
    '⚠️ This report is generated from static analysis. Verify critical findings independently.',
    '',
  ];

  const bodyLines: string[] = [];

  for (const section of input.sections) {
    const markdown = getSectionMarkdown(section, input);
    if (markdown != null && markdown !== undefined) {
      bodyLines.push(markdown);
      // Ensure section ends with a newline separator
      if (!markdown.endsWith('\n')) {
        bodyLines.push('');
      }
    }
  }

  const content = [...headerLines, ...bodyLines].join('\n');

  // ── Write to file if outputPath provided ─────────────────────────────────────
  if (input.outputPath) {
    if (existsSync(input.outputPath) && input.overwrite !== true) {
      throw new Error(
        `File already exists: ${input.outputPath}. Set overwrite=true to overwrite.`,
      );
    }

    writeFileSync(input.outputPath, content, 'utf8');
    return { content, writtenToFile: true, outputPath: input.outputPath };
  }

  return { content, writtenToFile: false };
}
